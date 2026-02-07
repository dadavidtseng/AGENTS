/**
 * Akash Network Certificate Management
 *
 * Provides certificate operations for Akash Network deployments. Certificates are
 * required for mTLS authentication with Akash providers and are tied to wallet addresses.
 *
 * @module targets/akash/certificate-manager
 */

import { certificateManager, type CertificatePem } from '@akashnetwork/chain-sdk';
import type { DeliverTxResponse } from '@cosmjs/stargate';

import type { Result } from '../../types/index.js';
import type { AkashProviderTlsCertificate } from './types.js';
import type { AkashClient } from './client.js';
import { success, failure } from '../../types/index.js';
import { CertificateError, CertificateErrorCodes, getErrorMessage } from '../../errors/index.js';

/** Certificate JSON structure (for parsing) */
export interface CertificateJson {
  cert: string;
  privateKey: string;
  publicKey: string;
  chain?: string;
}

/** Certificate broadcast result */
export interface CertificateBroadcastResult {
  transactionHash: string;
  height: number;
  success: boolean;
}

/** On-chain certificate information */
export interface OnChainCertificateInfo {
  exists: boolean;
  count: number;
  serials: string[];
}

/** Certificate revocation result */
export interface CertificateRevokeResult {
  transactionHash: string;
  height: number;
  success: boolean;
  revokedCount: number;
  revokedSerials: string[];
}

/**
 * Generate a new Akash certificate
 *
 * Creates a fresh X.509 certificate with PEM encoding for mTLS authentication.
 *
 * @param walletAddress - Akash wallet address to tie certificate to
 * @returns Result with generated certificate or error
 *
 * @example
 * ```typescript
 * const result = generateCertificate('akash1abc...');
 * if (result.success) {
 *   console.log('Certificate generated:', result.data);
 * }
 * ```
 */
export async function generateCertificate(
  walletAddress: string
): Promise<Result<AkashProviderTlsCertificate, CertificateError>> {
  try {
    // Step 1: Validate wallet address format
    if (!walletAddress || !walletAddress.startsWith('akash')) {
      return failure(new CertificateError(
        'Invalid wallet address format',
        CertificateErrorCodes.CERT_INVALID,
        { walletAddress }
      ));
    }

    // Step 2: Generate certificate with PEM encoding
    // chain-sdk certificateManager handles all cryptographic operations
    const certPem: CertificatePem = await certificateManager.generatePEM(walletAddress);

    // Step 3: Convert to AkashProviderTlsCertificate format
    const certificate: AkashProviderTlsCertificate = {
      cert: certPem.cert,
      publicKey: certPem.publicKey,
      privateKey: certPem.privateKey,
    };

    // Step 4: Validate generated certificate structure
    const validationResult = parseCertificate(certificate);
    if (!validationResult.success) {
      return validationResult;
    }

    // Step 5: Return generated certificate
    return success(certificate);
  } catch (error) {
    const errMsg = getErrorMessage(error);
    return failure(new CertificateError(
      `Failed to generate certificate: ${errMsg}`,
      CertificateErrorCodes.CERT_CREATION_FAILED,
      { error: errMsg }
    ));
  }
}

/**
 * Parse and validate certificate from JSON
 *
 * Converts certificate JSON data into a validated Certificate object with structure and format validation.
 *
 * @param json - Certificate data to parse (from file, API, etc.)
 * @returns Result with validated certificate or error
 *
 * @example
 * ```typescript
 * const result = parseCertificate(certJson);
 * if (result.success) {
 *   await broadcastCertificate(wallet, result.data, client);
 * }
 * ```
 */
export function parseCertificate(
  json: unknown
): Result<AkashProviderTlsCertificate, CertificateError> {
  try {
    // Step 1: Validate input is an object
    if (!json || typeof json !== 'object') {
      return failure(new CertificateError(
        'Certificate must be an object',
        CertificateErrorCodes.CERT_INVALID,
        { providedType: typeof json }
      ));
    }

    const cert = json as Record<string, unknown>;

    // Step 2: Check required fields exist
    const requiredFields = ['cert', 'privateKey', 'publicKey'];
    for (const field of requiredFields) {
      if (!cert[field] || typeof cert[field] !== 'string') {
        return failure(new CertificateError(
          `Certificate is missing required field: ${field}`,
          CertificateErrorCodes.CERT_INVALID,
          { missingField: field, provided: Object.keys(cert) }
        ));
      }
    }

    // Step 3: Validate PEM format for each field
    // PEM format requires -----BEGIN ... and -----END ... markers
    for (const field of requiredFields) {
      const pemData = cert[field] as string;
      if (!pemData.includes('-----BEGIN') || !pemData.includes('-----END')) {
        return failure(new CertificateError(
          `Certificate field ${field} is not in PEM format`,
          CertificateErrorCodes.CERT_INVALID,
          { field, pemData: pemData.substring(0, 50) + '...' }
        ));
      }
    }

    // Step 4: Return validated certificate
    return success({
      cert: cert.cert as string,
      privateKey: cert.privateKey as string,
      publicKey: cert.publicKey as string,
      chain: cert.chain as string | undefined,
    });
  } catch (error) {
    const errMsg = getErrorMessage(error);
    return failure(new CertificateError(
      `Failed to parse certificate: ${errMsg}`,
      CertificateErrorCodes.CERT_INVALID,
      { error: errMsg }
    ));
  }
}

/**
 * Certificate Manager for Akash Network
 *
 * Handles certificate operations using AkashClient's SDK instance.
 * Provides methods for querying, broadcasting, and ensuring certificates exist.
 */
export class CertificateManager {
  private readonly client: AkashClient;

  /**
   * Create a new CertificateManager
   *
   * @param client - AkashClient instance to use for blockchain operations
   *
   * @example
   * ```typescript
   * const client = new AkashClient({ network: 'mainnet', signer });
   * const certManager = new CertificateManager(client);
   * ```
   */
  constructor(client: AkashClient) {
    this.client = client;
  }

  /**
   * Query certificate from Akash blockchain
   *
   * Checks if a valid certificate exists on-chain for the wallet address.
   *
   * @param walletAddress - Akash wallet address to query
   * @returns Result with certificate info or null if not found
   *
   * @example
   * ```typescript
   * const result = await certManager.query('akash1abc...');
   * if (result.success && result.data) {
   *   console.log(`Found ${result.data.count} certificate(s) on-chain`);
   * }
   * ```
   */
  async query(
    walletAddress: string
  ): Promise<Result<OnChainCertificateInfo | null, CertificateError>> {
    try {
      // Query certificates for wallet address using client's SDK
      // Filter for valid certificates only (exclude revoked)
      const response = await this.client['sdk'].akash.cert.v1.getCertificates({
        filter: {
          owner: walletAddress,
          state: 'valid',
        },
      });

      // Return certificate existence info
      const certificates = response.certificates || [];
      const certificateCount = certificates.length;
      const certificateExists = certificateCount > 0;

      if (certificateExists) {
        // Extract serial numbers from response
        const serials = certificates.map((c) => c.serial);

        return success({
          exists: true,
          count: certificateCount,
          serials,
        });
      }

      // No certificate found
      return success(null);
    } catch (error) {
      // Don't fail for query errors - certificate might still work
      // Just return null and let caller decide what to do
      return success(null);
    }
  }

  /**
   * Broadcast certificate to Akash blockchain
   *
   * Submits a certificate transaction to the blockchain, making it available
   * for mTLS authentication with providers.
   *
   * Requires: Client must have signing capability (signer configured)
   *
   * @param walletAddress - Wallet address that owns the certificate
   * @param certificate - Certificate to broadcast
   * @returns Result with broadcast result or error
   *
   * @example
   * ```typescript
   * const cert = await generateCertificate('akash1abc...');
   * const result = await certManager.broadcast('akash1abc...', cert.data);
   * if (result.success) {
   *   console.log('Certificate on-chain:', result.data.transactionHash);
   * }
   * ```
   */
  async broadcast(
    walletAddress: string,
    certificate: AkashProviderTlsCertificate
  ): Promise<Result<CertificateBroadcastResult, CertificateError>> {
    try {
      // Validate client can sign transactions
      if (!this.client.canSign()) {
        return failure(new CertificateError(
          'Cannot broadcast certificate: client has no signing capability',
          CertificateErrorCodes.CERT_BROADCAST_FAILED,
          { suggestion: 'Provide a signer when creating AkashClient' }
        ));
      }

      // Validate certificate structure
      const validationResult = parseCertificate(certificate);
      if (!validationResult.success) {
        return failure(new CertificateError(
          'Cannot broadcast invalid certificate',
          CertificateErrorCodes.CERT_INVALID,
          { originalError: validationResult.error.message }
        ));
      }

      // Capture transaction metadata
      let txHash = '';
      let txHeight = 0;

      // Broadcast certificate to blockchain using client's SDK
      await this.client['sdk'].akash.cert.v1.createCertificate({
        owner: walletAddress,
        cert: new Uint8Array(Buffer.from(certificate.cert)),
        pubkey: new Uint8Array(Buffer.from(certificate.publicKey)),
      }, {
        afterBroadcast: (txResponse: DeliverTxResponse) => {
          txHash = txResponse.transactionHash;
          txHeight = txResponse.height;
        }
      });

      // Return successful broadcast result
      return success({
        transactionHash: txHash,
        height: txHeight,
        success: true,
      });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new CertificateError(
        `Failed to broadcast certificate: ${errMsg}`,
        CertificateErrorCodes.CERT_BROADCAST_FAILED,
        { error: errMsg }
      ));
    }
  }

  /**
   * Revoke all valid certificates on Akash blockchain
   *
   * Revokes all existing valid certificates for a wallet, allowing a new one
   * to be created. Automatically queries the blockchain to find all certificate
   * serial numbers and revokes each one.
   *
   * Requires: Client must have signing capability (signer configured)
   *
   * @param walletAddress - Wallet address that owns the certificates
   * @returns Result with revocation result or error
   *
   * @example
   * ```typescript
   * const result = await certManager.revoke('akash1abc...');
   * if (result.success) {
   *   console.log(`Revoked ${result.data.revokedCount} certificate(s)`);
   *   // Now you can create a new certificate
   * }
   * ```
   */
  async revoke(
    walletAddress: string
  ): Promise<Result<CertificateRevokeResult, CertificateError>> {
    try {
      // Validate client can sign transactions
      if (!this.client.canSign()) {
        return failure(new CertificateError(
          'Cannot revoke certificate: client has no signing capability',
          CertificateErrorCodes.CERT_REVOKE_FAILED,
          { suggestion: 'Provide a signer when creating AkashClient' }
        ));
      }

      // Query blockchain to find all valid certificate serials
      const queryResult = await this.query(walletAddress);

      if (!queryResult.success) {
        return failure(new CertificateError(
          'Failed to query existing certificates',
          CertificateErrorCodes.CERT_REVOKE_FAILED,
          { error: queryResult.error?.message }
        ));
      }

      if (!queryResult.data || queryResult.data.serials.length === 0) {
        return failure(new CertificateError(
          'No valid certificate found to revoke',
          CertificateErrorCodes.CERT_NOT_FOUND,
          { walletAddress }
        ));
      }

      const serials = queryResult.data.serials;
      const revokedSerials: string[] = [];

      // Capture transaction metadata from last revocation
      let txHash = '';
      let txHeight = 0;

      // Revoke all valid certificates
      for (const serial of serials) {
        if (!serial) continue;

        await this.client['sdk'].akash.cert.v1.revokeCertificate({
          id: {
            owner: walletAddress,
            serial,
          },
        }, {
          afterBroadcast: (txResponse: DeliverTxResponse) => {
            txHash = txResponse.transactionHash;
            txHeight = txResponse.height;
          }
        });

        revokedSerials.push(serial);
      }

      // Return successful revoke result
      return success({
        transactionHash: txHash,
        height: txHeight,
        success: true,
        revokedCount: revokedSerials.length,
        revokedSerials,
      });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new CertificateError(
        `Failed to revoke certificate: ${errMsg}`,
        CertificateErrorCodes.CERT_REVOKE_FAILED,
        { error: errMsg }
      ));
    }
  }

  /**
   * Get or create certificate (convenience method)
   *
   * Handles the complete certificate workflow:
   * 1. Use existing certificate if provided and valid
   * 2. Check blockchain for existing certificate
   * 3. Generate and broadcast new certificate if none exists
   *
   * Requires: Client must have signing capability for certificate creation
   *
   * @param walletAddress - Wallet address to ensure certificate for
   * @param options - Optional existing certificate
   * @returns Result with valid certificate or error
   *
   * @example
   * ```typescript
   * const result = await certManager.getOrCreate('akash1abc...');
   * if (result.success) {
   *   await sendManifest(lease, manifest, result.data);
   * }
   * ```
   */
  async getOrCreate(
    walletAddress: string,
    options?: {
      existingCertificate?: AkashProviderTlsCertificate;
    }
  ): Promise<Result<AkashProviderTlsCertificate, CertificateError>> {
    try {
      // Step 1: Use existing certificate if provided and valid
      if (options?.existingCertificate) {
        const validationResult = parseCertificate(options.existingCertificate);
        if (validationResult.success) {
          return validationResult;
        }
        // Invalid existing cert, continue to generate new one
      }

      // Step 2: Check blockchain for existing certificate
      const queryResult = await this.query(walletAddress);
      if (queryResult.success && queryResult.data) {
        // Certificate exists on-chain, but we don't have the private key
        // This shouldn't happen in normal flow - caller should provide cert
        return failure(new CertificateError(
          'Certificate exists on blockchain but private key not provided',
          CertificateErrorCodes.CERT_NOT_FOUND,
          {
            suggestion:
              'Provide existing certificate or revoke on-chain certificate',
          }
        ));
      }

      // Step 3: Generate new certificate
      const generateResult = await generateCertificate(walletAddress);
      if (!generateResult.success) {
        return generateResult;
      }

      // Step 4: Broadcast to blockchain
      const broadcastResult = await this.broadcast(
        walletAddress,
        generateResult.data
      );
      if (!broadcastResult.success) {
        return failure(broadcastResult.error);
      }

      // Step 5: Return generated and broadcast certificate
      return success(generateResult.data);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new CertificateError(
        `Failed to ensure certificate: ${errMsg}`,
        CertificateErrorCodes.CERT_ERROR,
        { error: errMsg }
      ));
    }
  }
}
