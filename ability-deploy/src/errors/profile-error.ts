/**
 * Profile-related error classes
 *
 * Errors specific to deployment profile loading and validation
 *
 * @module errors/profile-error
 */

import { DeploymentError, type ErrorContext, type ErrorSeverity } from './deployment-error.js';

/**
 * Profile error codes
 */
export const ProfileErrorCodes = {
  /** agent.json file not found */
  AGENT_JSON_NOT_FOUND: 'AGENT_JSON_NOT_FOUND',

  /** agent.json parsing failed */
  AGENT_JSON_PARSE_ERROR: 'AGENT_JSON_PARSE_ERROR',

  /** Requested profile not found in agent.json */
  PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',

  /** Profile is missing required fields */
  PROFILE_INVALID: 'PROFILE_INVALID',

  /** No profiles defined in agent.json */
  NO_PROFILES_DEFINED: 'NO_PROFILES_DEFINED',

  /** Profile validation failed */
  PROFILE_VALIDATION_ERROR: 'PROFILE_VALIDATION_ERROR',

  /** Service configuration is invalid */
  SERVICE_CONFIG_INVALID: 'SERVICE_CONFIG_INVALID',

  /** Generic profile error */
  PROFILE_ERROR: 'PROFILE_ERROR',
} as const;

export type ProfileErrorCode =
  (typeof ProfileErrorCodes)[keyof typeof ProfileErrorCodes];

/**
 * Profile loading or validation error
 *
 * Thrown when profile-related operations fail, including:
 * - agent.json not found or invalid
 * - Profile not found
 * - Profile validation failures
 * - Service configuration errors
 *
 * @example
 * throw new ProfileError(
 *   'Profile "production" not found in agent.json',
 *   ProfileErrorCodes.PROFILE_NOT_FOUND,
 *   { profile: 'production', availableProfiles: ['dev', 'staging'] },
 *   false,
 *   'Available profiles: dev, staging'
 * );
 */
export class ProfileError extends DeploymentError {
  constructor(
    message: string,
    code: ProfileErrorCode = ProfileErrorCodes.PROFILE_ERROR,
    context: ErrorContext = {},
    recoverable: boolean = false,
    suggestion?: string,
    severity: ErrorSeverity = 'error',
    cause?: Error
  ) {
    super(message, code, context, recoverable, suggestion, severity, cause);

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, ProfileError.prototype);

    this.name = 'ProfileError';
  }
}

/**
 * Create an agent.json not found error
 *
 * @param projectRoot - Project root path
 * @returns ProfileError instance
 */
export function agentJsonNotFoundError(projectRoot: string): ProfileError {
  return new ProfileError(
    `agent.json not found in ${projectRoot}`,
    ProfileErrorCodes.AGENT_JSON_NOT_FOUND,
    { projectRoot },
    false,
    'Create an agent.json file with deployment configuration',
    'error'
  );
}

/**
 * Create an agent.json parse error
 *
 * @param path - Path to agent.json
 * @param cause - Original parsing error
 * @returns ProfileError instance
 */
export function agentJsonParseError(path: string, cause: Error): ProfileError {
  return new ProfileError(
    `Failed to parse agent.json at ${path}`,
    ProfileErrorCodes.AGENT_JSON_PARSE_ERROR,
    { path },
    false,
    'Check that agent.json contains valid JSON',
    'error',
    cause
  );
}

/**
 * Create a profile not found error
 *
 * @param profileName - Name of profile that wasn't found
 * @param availableProfiles - List of available profile names
 * @returns ProfileError instance
 */
export function profileNotFoundError(
  profileName: string,
  availableProfiles: readonly string[]
): ProfileError {
  const suggestion =
    availableProfiles.length > 0
      ? `Available profiles: ${availableProfiles.join(', ')}`
      : 'No deployment profiles are defined in agent.json';

  return new ProfileError(
    `Profile "${profileName}" not found`,
    ProfileErrorCodes.PROFILE_NOT_FOUND,
    { profileName, availableProfiles },
    false,
    suggestion,
    'error'
  );
}

/**
 * Create a no profiles defined error
 *
 * @param path - Path to agent.json
 * @returns ProfileError instance
 */
export function noProfilesDefinedError(path: string): ProfileError {
  return new ProfileError(
    'No deployment profiles defined in agent.json',
    ProfileErrorCodes.NO_PROFILES_DEFINED,
    { path },
    false,
    'Add at least one profile to the "deploy" section of agent.json',
    'error'
  );
}

/**
 * Create a profile invalid error
 *
 * @param profileName - Name of invalid profile
 * @param reason - Why the profile is invalid
 * @param field - Field that is invalid
 * @returns ProfileError instance
 */
export function profileInvalidError(
  profileName: string,
  reason: string,
  field?: string
): ProfileError {
  return new ProfileError(
    `Profile "${profileName}" is invalid: ${reason}`,
    ProfileErrorCodes.PROFILE_INVALID,
    { profileName, reason, field },
    false,
    field ? `Fix the "${field}" field in the profile` : 'Fix the profile configuration',
    'error'
  );
}

/**
 * Create a service config invalid error
 *
 * @param serviceName - Name of service with invalid config
 * @param reason - Why the config is invalid
 * @returns ProfileError instance
 */
export function serviceConfigInvalidError(
  serviceName: string,
  reason: string
): ProfileError {
  return new ProfileError(
    `Service "${serviceName}" has invalid configuration: ${reason}`,
    ProfileErrorCodes.SERVICE_CONFIG_INVALID,
    { serviceName, reason },
    false,
    'Review the service configuration in your deployment profile',
    'error'
  );
}

/**
 * Type guard to check if an error is a ProfileError
 *
 * @param error - The error to check
 * @returns True if error is a ProfileError
 */
export function isProfileError(error: unknown): error is ProfileError {
  return error instanceof ProfileError;
}
