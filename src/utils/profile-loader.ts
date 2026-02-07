/**
 * Profile loading and validation utilities
 *
 * Functions for loading deployment profiles from agent.json
 *
 * @module utils/profile-loader
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentConfig,
  DeploymentProfile,
  LoadedProfile,
  DeploymentLogger,
} from '../types/index.js';
import {
  agentJsonNotFoundError,
  agentJsonParseError,
  profileNotFoundError,
  noProfilesDefinedError,
  profileInvalidError,
} from '../errors/index.js';
import { defaultLogger } from './logger.js';

/**
 * Load agent.json from a project root directory
 *
 * @param projectRoot - Path to project root
 * @param logger - Optional logger
 * @returns Parsed agent configuration
 * @throws {ProfileError} If agent.json not found or invalid
 *
 * @example
 * const config = await loadAgentConfig('/path/to/project');
 */
export async function loadAgentConfig(
  projectRoot: string,
  logger: DeploymentLogger = defaultLogger
): Promise<AgentConfig> {
  const agentJsonPath = join(projectRoot, 'agent.json');

  logger.debug(`Loading agent.json from ${agentJsonPath}`);

  let content: string;
  try {
    content = await readFile(agentJsonPath, 'utf-8');
  } catch (error) {
    throw agentJsonNotFoundError(projectRoot);
  }

  try {
    const config = JSON.parse(content) as AgentConfig;
    logger.debug(`Loaded agent config: ${config.name} v${config.version}`);
    return config;
  } catch (error) {
    throw agentJsonParseError(agentJsonPath, error as Error);
  }
}

/**
 * Get all available deployment profile names from agent config
 *
 * @param config - Agent configuration
 * @returns Array of profile names
 *
 * @example
 * const profiles = getAvailableProfiles(config);
 * console.log(profiles); // ['local-dev', 'production', 'staging']
 */
export function getAvailableProfiles(config: AgentConfig): readonly string[] {
  if (!config.deploy) {
    return [];
  }

  return Object.keys(config.deploy);
}

/**
 * Load a specific deployment profile from agent config
 *
 * @param config - Agent configuration
 * @param profileName - Name of profile to load
 * @param projectRoot - Project root path
 * @param logger - Optional logger
 * @returns Loaded profile with metadata
 * @throws {ProfileError} If profile not found or invalid
 *
 * @example
 * const profile = await loadDeploymentProfile(config, 'production', '/path/to/project');
 */
export async function loadDeploymentProfile(
  config: AgentConfig,
  profileName: string,
  projectRoot: string,
  logger: DeploymentLogger = defaultLogger
): Promise<LoadedProfile<DeploymentProfile>> {
  logger.debug(`Loading deployment profile: ${profileName}`);

  // Check if deploy section exists
  if (!config.deploy) {
    throw noProfilesDefinedError(join(projectRoot, 'agent.json'));
  }

  // Check if profile exists
  const availableProfiles = getAvailableProfiles(config);
  const profile = config.deploy[profileName];

  if (!profile) {
    throw profileNotFoundError(profileName, availableProfiles);
  }

  // Validate profile has required fields
  validateProfile(profileName, profile);

  logger.debug(`Loaded profile: ${profileName} (target: ${profile.target})`);

  return {
    name: profileName,
    profile: profile as DeploymentProfile,
    agent: config,
    projectRoot,
  };
}

/**
 * Load the first available deployment profile
 *
 * Useful when no specific profile is requested
 *
 * @param config - Agent configuration
 * @param projectRoot - Project root path
 * @param logger - Optional logger
 * @returns Loaded profile with metadata
 * @throws {ProfileError} If no profiles are defined
 *
 * @example
 * const profile = await loadFirstProfile(config, '/path/to/project');
 */
export async function loadFirstProfile(
  config: AgentConfig,
  projectRoot: string,
  logger: DeploymentLogger = defaultLogger
): Promise<LoadedProfile<DeploymentProfile>> {
  const availableProfiles = getAvailableProfiles(config);

  if (availableProfiles.length === 0) {
    throw noProfilesDefinedError(join(projectRoot, 'agent.json'));
  }

  const firstProfileName = availableProfiles[0];
  if (!firstProfileName) {
    throw noProfilesDefinedError(join(projectRoot, 'agent.json'));
  }

  logger.log(`No profile specified, using first available: ${firstProfileName}`);

  return loadDeploymentProfile(config, firstProfileName, projectRoot, logger);
}

/**
 * Validate a deployment profile has required fields
 *
 * @param profileName - Name of profile being validated
 * @param profile - Profile to validate
 * @throws {ProfileError} If profile is invalid
 *
 * @internal
 */
function validateProfile(
  profileName: string,
  profile: unknown
): asserts profile is DeploymentProfile {
  if (typeof profile !== 'object' || profile === null) {
    throw profileInvalidError(profileName, 'Profile must be an object');
  }

  const p = profile as Record<string, unknown>;

  // Check required fields
  if (!p.target) {
    throw profileInvalidError(
      profileName,
      'Missing required field: target',
      'target'
    );
  }

  if (typeof p.target !== 'string') {
    throw profileInvalidError(
      profileName,
      'Field "target" must be a string',
      'target'
    );
  }

  if (!['local', 'akash'].includes(p.target)) {
    throw profileInvalidError(
      profileName,
      `Invalid target: ${p.target}. Must be "local" or "akash"`,
      'target'
    );
  }

  // Check services exist
  if (!p.services) {
    throw profileInvalidError(
      profileName,
      'Missing required field: services',
      'services'
    );
  }

  if (typeof p.services !== 'object' || p.services === null) {
    throw profileInvalidError(
      profileName,
      'Field "services" must be an object',
      'services'
    );
  }

  // Check at least one service is defined
  const serviceCount = Object.keys(p.services).length;
  if (serviceCount === 0) {
    throw profileInvalidError(
      profileName,
      'At least one service must be defined',
      'services'
    );
  }

  // Target-specific validation
  if (p.target === 'local') {
    if (!p.engine) {
      throw profileInvalidError(
        profileName,
        'Local profiles must specify an engine (docker or podman)',
        'engine'
      );
    }

    if (!['docker', 'podman'].includes(p.engine as string)) {
      throw profileInvalidError(
        profileName,
        `Invalid engine: ${p.engine}. Must be "docker" or "podman"`,
        'engine'
      );
    }
  }

  if (p.target === 'akash') {
    if (!p.network) {
      throw profileInvalidError(
        profileName,
        'Akash profiles must specify a network (mainnet, testnet, or sandbox)',
        'network'
      );
    }

    if (!['mainnet', 'testnet', 'sandbox'].includes(p.network as string)) {
      throw profileInvalidError(
        profileName,
        `Invalid network: ${p.network}. Must be "mainnet", "testnet", or "sandbox"`,
        'network'
      );
    }
  }
}

/**
 * Load profile from project root by name or use first available
 *
 * Convenience function that combines loading agent.json and profile
 *
 * @param projectRoot - Path to project root
 * @param profileName - Optional profile name (uses first if not specified)
 * @param logger - Optional logger
 * @returns Loaded profile with metadata
 * @throws {ProfileError} If agent.json or profile invalid
 *
 * @example
 * const profile = await loadProfile('/path/to/project', 'production');
 */
export async function loadProfile(
  projectRoot: string,
  profileName?: string,
  logger: DeploymentLogger = defaultLogger
): Promise<LoadedProfile<DeploymentProfile>> {
  const config = await loadAgentConfig(projectRoot, logger);

  if (profileName) {
    return loadDeploymentProfile(config, profileName, projectRoot, logger);
  }

  return loadFirstProfile(config, projectRoot, logger);
}
