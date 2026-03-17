/**
 * Error classes barrel export
 *
 * Centralized export point for all error types in deploy-ability
 *
 * @module errors
 */

// Base error
export {
  DeploymentError,
  isDeploymentError,
  type ErrorContext,
  type ErrorSeverity,
} from './deployment-error.js';

// Wallet errors
export {
  WalletError,
  isWalletError,
  WalletErrorCodes,
  walletNotFoundError,
  connectionRejectedError,
  insufficientFundsError,
  walletLockedError,
  signingFailedError,
  networkMismatchError,
  type WalletErrorCode,
} from './wallet-error.js';

// Certificate errors
export {
  CertificateError,
  isCertificateError,
  CertificateErrorCodes,
  certificateNotFoundError,
  certificateInvalidError,
  certificateExpiredError,
  certificateCreationFailedError,
  certificateBroadcastFailedError,
  type CertificateErrorCode,
} from './certificate-error.js';

// Provider errors
export {
  ProviderError,
  isProviderError,
  ProviderErrorCodes,
  providerUnreachableError,
  manifestRejectedError,
  noBidsReceivedError,
  containerTimeoutError,
  containerStartFailedError,
  type ProviderErrorCode,
} from './provider-error.js';

// Profile errors
export {
  ProfileError,
  isProfileError,
  ProfileErrorCodes,
  agentJsonNotFoundError,
  agentJsonParseError,
  profileNotFoundError,
  noProfilesDefinedError,
  profileInvalidError,
  serviceConfigInvalidError,
  type ProfileErrorCode,
} from './profile-error.js';

// Error utilities
export { getErrorMessage } from './error-utils.js';
