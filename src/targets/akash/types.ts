/**
 * Akash Network Type Definitions
 *
 * Type-safe interfaces for Akash Network deployment operations using proper
 * TypeScript types from @cosmjs and @walletconnect libraries (zero `any` types).
 *
 * @module targets/akash/types
 */

import type { OfflineAminoSigner } from '@cosmjs/amino';
import type { OfflineDirectSigner } from '@cosmjs/proto-signing';
import type { SessionTypes } from '@walletconnect/types';
import { SignClient } from '@walletconnect/sign-client';

/** Keplr signer with both Amino (legacy) and Direct (modern protobuf) signing capabilities */
export type KeplrSigner = OfflineAminoSigner & OfflineDirectSigner;

/** On-chain account state (address, pubkey, nonce) */
export interface AccountData {
  readonly address: string;
  readonly pubkey: Uint8Array | null;
  readonly accountNumber: number;
  readonly sequence: number;
}

/** Wallet connection context for Akash operations (signing, querying, WalletConnect session) */
export interface WalletContext {
  readonly address: string;
  readonly signer: KeplrSigner;
  readonly offlineSigner: KeplrSigner;
  readonly signClient?: InstanceType<typeof SignClient>;
  readonly session?: SessionTypes.Struct;
  readonly chainId?: string;
  readonly account?: AccountData;
}

/**
 * X.509 certificate for mTLS authentication with Akash providers.
 * Required for secure communication after lease creation.
 */
export interface AkashProviderTlsCertificate {
  /** Private key in PEM format (keep secret!) */
  readonly privateKey: string;
  readonly publicKey: string;
  readonly cert: string;
  readonly chain?: string;
}

/** Type guard: Check if wallet has WalletConnect session */
export function isWalletConnectSession(ctx: WalletContext): ctx is WalletContext & {
  signClient: InstanceType<typeof SignClient>;
  session: SessionTypes.Struct;
} {
  return ctx.signClient !== undefined && ctx.session !== undefined;
}

/** Type guard: Check if wallet has account data */
export function hasAccountData(ctx: WalletContext): ctx is WalletContext & {
  account: AccountData;
} {
  return ctx.account !== undefined;
}

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Geographic location from IP geolocation.
 * May not be 100% accurate, especially for VPN/privacy-focused providers.
 */
export interface ProviderLocation {
  readonly region: string;
  readonly regionCode: string;
  readonly country: string;
  readonly countryCode: string;
  readonly latitude?: string;
  readonly longitude?: string;
}

/**
 * Provider uptime metrics over 1/7/30 day periods.
 * Values are 0.0-1.0 (0%-100%). Not available for newly registered providers.
 */
export interface ProviderReliability {
  readonly uptime1d: number;
  readonly uptime7d: number;
  readonly uptime30d: number;
  readonly isOnline: boolean;
  readonly lastCheckDate?: Date;
}

/**
 * Complete provider information with identity, location, and reliability metrics.
 * Optional fields may be unavailable depending on provider registration and indexer data.
 */
export interface ProviderInfo {
  readonly owner: string;
  readonly hostUri: string;
  readonly name?: string;
  readonly email?: string;
  readonly website?: string;
  /** Verified by community auditors (Overclock Labs) for hardware/uptime standards */
  readonly isAudited: boolean;
  readonly location?: ProviderLocation;
  readonly reliability?: ProviderReliability;
  readonly akashVersion?: string;
  readonly cosmosSdkVersion?: string;
}

// ============================================================================
// Lease Types
// ============================================================================

/**
 * Complete lease details from blockchain query
 */
export interface LeaseDetails {
  readonly owner: string;
  readonly provider: string;
  readonly dseq: string;
  readonly gseq: number;
  readonly oseq: number;
  readonly state: 'active' | 'closed' | 'insufficient_funds';
  readonly price: {
    readonly denom: string;
    readonly amount: string;
  };
  readonly createdAt: string;
}
