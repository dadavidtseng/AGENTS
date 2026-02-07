/**
 * Type Validators and Constructors for Branded Types
 *
 * This module provides runtime validation and safe constructors for branded types
 * using Zod. Instead of blind type assertions (as SomeType), these schemas validate
 * input and provide compile-time guarantees.
 *
 * **Philosophy:**
 * - Branded types provide documentation and prevent mixing incompatible values
 * - Zod schemas enforce the brand contract at runtime
 * - Single point of validation - once created, branded values are trusted
 *
 * **Why Zod:**
 * - Composable, reusable schemas
 * - Excellent error messages
 * - Type inference works perfectly with branded types
 * - Industry standard (Vercel, tRPC, Remix, etc.)
 *
 * @module types/validators
 */

import { z } from 'zod';
import type { WalletAddress, DeploymentSequence } from './common.js';

// =============================================================================
// Wallet Address Validation
// =============================================================================

/**
 * Zod schema for Akash wallet addresses
 *
 * Akash wallet addresses are bech32-encoded and always start with "akash1".
 *
 * **Validation rules:**
 * - Must start with "akash1"
 * - Must be at least 44 characters (akash1 + 38 character bech32 address)
 * - Must contain only lowercase alphanumeric characters (bech32 charset)
 *
 * **Note:** This performs basic format validation. It does NOT verify:
 * - Whether the address exists on-chain
 * - Whether the checksum is valid (full bech32 validation would require additional library)
 *
 * @example Valid addresses
 * ```typescript
 * WalletAddressSchema.parse('akash1...');  // 44+ chars starting with akash1
 * ```
 *
 * @example Invalid addresses (will throw ZodError)
 * ```typescript
 * WalletAddressSchema.parse('cosmos1...');  // Wrong prefix
 * WalletAddressSchema.parse('akash1abc');   // Too short
 * WalletAddressSchema.parse('AKASH1...');   // Uppercase not allowed
 * ```
 */
const WalletAddressSchemaInternal = z
  .string()
  .min(44, 'Wallet address must be at least 44 characters')
  .startsWith('akash1', 'Wallet address must start with "akash1"')
  .regex(
    /^akash1[02-9ac-hj-np-z]+$/,
    'Wallet address must be lowercase bech32 format'
  );

export const WalletAddressSchema = WalletAddressSchemaInternal;

/**
 * Validates and creates a WalletAddress branded type
 *
 * Throws ZodError if validation fails with detailed error messages.
 *
 * @param address - String to validate as wallet address
 * @returns Branded WalletAddress
 * @throws {ZodError} If address format is invalid
 *
 * @example
 * ```typescript
 * const addr = createWalletAddress('akash1...');
 * ```
 */
export function createWalletAddress(address: string): WalletAddress {
  WalletAddressSchema.parse(address);
  return address as WalletAddress;
}

/**
 * Type guard to check if a string is a valid wallet address
 *
 * @param address - String to check
 * @returns true if address is valid
 *
 * @example
 * ```typescript
 * if (isWalletAddress(address)) {
 *   // TypeScript knows address is WalletAddress
 * }
 * ```
 */
export function isWalletAddress(address: string): address is WalletAddress {
  return WalletAddressSchema.safeParse(address).success;
}

/**
 * Safely converts unknown value to WalletAddress
 *
 * Returns undefined instead of throwing if validation fails.
 * Useful for optional fields or untrusted input.
 *
 * @param value - Value to convert
 * @returns WalletAddress if valid, undefined otherwise
 *
 * @example
 * ```typescript
 * const addr = toWalletAddress(untrustedInput);
 * if (addr) {
 *   // Use validated address
 * }
 * ```
 */
export function toWalletAddress(value: unknown): WalletAddress | undefined {
  const result = WalletAddressSchema.safeParse(value);
  return result.success ? (result.data as WalletAddress) : undefined;
}

// =============================================================================
// Deployment Sequence Validation
// =============================================================================

/**
 * Zod schema for deployment sequences (dseq)
 *
 * Deployment sequences are positive integers assigned by the Akash blockchain
 * to uniquely identify deployments. They start from 1 and increment.
 *
 * **Validation rules:**
 * - Must be a positive integer (>= 1)
 * - Must be a safe integer (within JavaScript's MAX_SAFE_INTEGER)
 *
 * @example Valid dseq
 * ```typescript
 * DeploymentSequenceSchema.parse(12345);  // ✓
 * ```
 *
 * @example Invalid dseq (will throw ZodError)
 * ```typescript
 * DeploymentSequenceSchema.parse(0);      // Must be >= 1
 * DeploymentSequenceSchema.parse(-100);   // Must be positive
 * DeploymentSequenceSchema.parse(1.5);    // Must be integer
 * ```
 */
const DeploymentSequenceSchemaInternal = z
  .number()
  .int('Deployment sequence must be an integer')
  .positive('Deployment sequence must be positive')
  .min(1, 'Deployment sequence must be at least 1')
  .safe('Deployment sequence exceeds safe integer range');

export const DeploymentSequenceSchema = DeploymentSequenceSchemaInternal;

/**
 * Validates and creates a DeploymentSequence branded type
 *
 * Throws ZodError if validation fails.
 *
 * @param dseq - Number to validate as deployment sequence
 * @returns Branded DeploymentSequence
 * @throws {ZodError} If dseq is invalid
 *
 * @example
 * ```typescript
 * const dseq = createDeploymentSequence(12345);
 * ```
 */
export function createDeploymentSequence(dseq: number): DeploymentSequence {
  DeploymentSequenceSchema.parse(dseq);
  return dseq as DeploymentSequence;
}

/**
 * Type guard to check if a number is a valid deployment sequence
 *
 * @param dseq - Number to check
 * @returns true if dseq is valid
 *
 * @example
 * ```typescript
 * if (isDeploymentSequence(dseq)) {
 *   // TypeScript knows dseq is DeploymentSequence
 * }
 * ```
 */
export function isDeploymentSequence(dseq: number): dseq is DeploymentSequence {
  return DeploymentSequenceSchema.safeParse(dseq).success;
}

/**
 * Safely converts unknown value to DeploymentSequence
 *
 * Returns undefined instead of throwing if validation fails.
 *
 * @param value - Value to convert
 * @returns DeploymentSequence if valid, undefined otherwise
 *
 * @example
 * ```typescript
 * const dseq = toDeploymentSequence(untrustedInput);
 * if (dseq) {
 *   // Use validated dseq
 * }
 * ```
 */
export function toDeploymentSequence(value: unknown): DeploymentSequence | undefined {
  const result = DeploymentSequenceSchema.safeParse(value);
  return result.success ? (result.data as DeploymentSequence) : undefined;
}
