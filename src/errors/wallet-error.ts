/**
 * Wallet-related error classes
 *
 * Errors specific to wallet connection, signing, and balance operations
 *
 * @module errors/wallet-error
 */

import { DeploymentError, type ErrorContext, type ErrorSeverity } from './deployment-error.js';

/**
 * Wallet error codes
 */
export const WalletErrorCodes = {
  /** Wallet extension not found (e.g., Keplr not installed) */
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',

  /** User rejected wallet connection */
  CONNECTION_REJECTED: 'CONNECTION_REJECTED',

  /** Wallet is locked */
  WALLET_LOCKED: 'WALLET_LOCKED',

  /** Insufficient funds for transaction */
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',

  /** Transaction signing failed */
  SIGNING_FAILED: 'SIGNING_FAILED',

  /** WalletConnect initialization failed */
  WALLETCONNECT_INIT_FAILED: 'WALLETCONNECT_INIT_FAILED',

  /** QR code modal was closed */
  QR_MODAL_CLOSED: 'QR_MODAL_CLOSED',

  /** Network mismatch (wallet on wrong network) */
  NETWORK_MISMATCH: 'NETWORK_MISMATCH',

  /** Account not found */
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',

  /** WalletConnect project ID missing or invalid */
  MISSING_PROJECT_ID: 'MISSING_PROJECT_ID',

  /** WalletConnect client initialization failed */
  INIT_FAILED: 'INIT_FAILED',

  /** Failed to generate connection URI */
  URI_GENERATION_FAILED: 'URI_GENERATION_FAILED',

  /** WalletConnect connection failed */
  CONNECTION_FAILED: 'CONNECTION_FAILED',

  /** No accounts in WalletConnect session */
  NO_ACCOUNTS: 'NO_ACCOUNTS',

  /** Connection approval timed out */
  APPROVAL_TIMEOUT: 'APPROVAL_TIMEOUT',

  /** User rejected connection approval */
  APPROVAL_REJECTED: 'APPROVAL_REJECTED',

  /** Approval process failed */
  APPROVAL_FAILED: 'APPROVAL_FAILED',

  /** No accounts available from signer */
  NO_SIGNER_ACCOUNTS: 'NO_SIGNER_ACCOUNTS',

  /** Failed to create wallet context */
  CONTEXT_CREATION_FAILED: 'CONTEXT_CREATION_FAILED',

  /** Failed to disconnect wallet */
  DISCONNECT_FAILED: 'DISCONNECT_FAILED',

  /** Feature not yet implemented */
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',

  /** Generic wallet error */
  WALLET_ERROR: 'WALLET_ERROR',
} as const;

export type WalletErrorCode =
  (typeof WalletErrorCodes)[keyof typeof WalletErrorCodes];

/**
 * Wallet connection or operation error
 *
 * Thrown when wallet-related operations fail, including:
 * - Wallet not found/installed
 * - Connection rejected by user
 * - Signing failures
 * - Insufficient balance
 *
 * @example
 * throw new WalletError(
 *   'Keplr wallet not found',
 *   WalletErrorCodes.WALLET_NOT_FOUND,
 *   {},
 *   false,
 *   'Please install the Keplr browser extension from https://keplr.app'
 * );
 */
export class WalletError extends DeploymentError {
  constructor(
    message: string,
    code: WalletErrorCode = WalletErrorCodes.WALLET_ERROR,
    context: ErrorContext = {},
    recoverable: boolean = false,
    suggestion?: string,
    severity: ErrorSeverity = 'error',
    cause?: Error
  ) {
    super(message, code, context, recoverable, suggestion, severity, cause);

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, WalletError.prototype);

    this.name = 'WalletError';
  }
}

/**
 * Create a wallet not found error
 *
 * @param walletType - Type of wallet that wasn't found
 * @returns WalletError instance
 */
export function walletNotFoundError(
  walletType: 'keplr' | 'walletconnect'
): WalletError {
  const suggestions = {
    keplr: 'Please install the Keplr browser extension from https://keplr.app',
    walletconnect:
      'Please provide a valid WalletConnect project ID or use Keplr instead',
  };

  return new WalletError(
    `${walletType === 'keplr' ? 'Keplr' : 'WalletConnect'} wallet not found`,
    WalletErrorCodes.WALLET_NOT_FOUND,
    { walletType },
    false,
    suggestions[walletType],
    'error'
  );
}

/**
 * Create a connection rejected error
 *
 * @returns WalletError instance
 */
export function connectionRejectedError(): WalletError {
  return new WalletError(
    'Wallet connection was rejected by user',
    WalletErrorCodes.CONNECTION_REJECTED,
    {},
    true,
    'Please approve the connection request in your wallet',
    'warning'
  );
}

/**
 * Create an insufficient funds error
 *
 * @param required - Amount required
 * @param available - Amount available
 * @param denom - Token denomination
 * @returns WalletError instance
 */
export function insufficientFundsError(
  required: number,
  available: number,
  denom: string = 'uakt'
): WalletError {
  const shortfall = required - available;

  return new WalletError(
    `Insufficient funds: need ${required} ${denom}, have ${available} ${denom}`,
    WalletErrorCodes.INSUFFICIENT_FUNDS,
    { required, available, shortfall, denom },
    false,
    `Please add at least ${shortfall} ${denom} to your wallet`,
    'error'
  );
}

/**
 * Create a wallet locked error
 *
 * @returns WalletError instance
 */
export function walletLockedError(): WalletError {
  return new WalletError(
    'Wallet is locked',
    WalletErrorCodes.WALLET_LOCKED,
    {},
    true,
    'Please unlock your wallet and try again',
    'warning'
  );
}

/**
 * Create a signing failed error
 *
 * @param operation - The operation that failed
 * @param cause - Original error
 * @returns WalletError instance
 */
export function signingFailedError(
  operation: string,
  cause?: Error
): WalletError {
  return new WalletError(
    `Failed to sign ${operation}`,
    WalletErrorCodes.SIGNING_FAILED,
    { operation },
    true,
    'Please try the operation again. If the problem persists, check your wallet connection.',
    'error',
    cause
  );
}

/**
 * Create a network mismatch error
 *
 * @param expected - Expected network
 * @param actual - Actual network
 * @returns WalletError instance
 */
export function networkMismatchError(
  expected: string,
  actual: string
): WalletError {
  return new WalletError(
    `Network mismatch: expected ${expected}, wallet is on ${actual}`,
    WalletErrorCodes.NETWORK_MISMATCH,
    { expected, actual },
    true,
    `Please switch your wallet to the ${expected} network`,
    'error'
  );
}

/**
 * Type guard to check if an error is a WalletError
 *
 * @param error - The error to check
 * @returns True if error is a WalletError
 */
export function isWalletError(error: unknown): error is WalletError {
  return error instanceof WalletError;
}
