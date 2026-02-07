/**
 * Profile type definitions from agent.json
 *
 * These types represent the structure of deployment profiles
 * as defined in an agent's agent.json configuration file.
 *
 * @module types/profiles
 */

import type {
  BaseServiceConfig,
  AkashServiceConfig,
  LocalServiceConfig,
  DeploymentTarget,
  Network,
  ContainerEngine,
} from './common.js';
import type {
  AkashRegion,
  AkashTier,
} from '../targets/akash/constants.js';

/**
 * Agent configuration from agent.json
 *
 * Root structure of the agent.json file
 */
export interface AgentConfig {
  /**
   * Agent name
   */
  readonly name: string;

  /**
   * Agent version
   */
  readonly version: string;

  /**
   * Agent description
   */
  readonly description?: string;

  /**
   * Agent license
   */
  readonly license?: string;

  /**
   * Build profiles
   */
  readonly build?: Readonly<Record<string, BuildProfile>>;

  /**
   * Deployment profiles
   */
  readonly deploy?: Readonly<Record<string, DeploymentProfile>>;

  /**
   * Scripts
   */
  readonly scripts?: Readonly<Record<string, string>>;

  /**
   * Broker configurations
   */
  readonly brokers?: Readonly<Record<string, string>>;

  /**
   * Abilities
   */
  readonly abilities?: Readonly<Record<string, string>>;
}

/**
 * Build profile configuration
 *
 * Defines how to build a container image
 */
export interface BuildProfile {
  /**
   * Image name and tag to build
   */
  readonly image: string;

  /**
   * Build engine
   */
  readonly engine: ContainerEngine;

  /**
   * Build platform
   */
  readonly platform: 'local' | 'akash';

  /**
   * Base image to use
   */
  readonly baseImage?: string;

  /**
   * Build as CLI tool
   */
  readonly cli?: boolean;
}

/**
 * Base deployment profile
 *
 * Common fields across all deployment profiles
 */
export interface BaseDeploymentProfile {
  /**
   * Deployment target
   */
  readonly target: DeploymentTarget;

  /**
   * Services to deploy
   */
  readonly services: Readonly<Record<string, BaseServiceConfig>>;

  /**
   * Enable verbose logging
   */
  readonly verbose?: boolean;

  /**
   * Show underlying commands
   */
  readonly showCommands?: boolean;

  /**
   * Skip confirmation prompts
   */
  readonly yes?: boolean;

  /**
   * Dry run mode
   */
  readonly dryRun?: boolean;
}

/**
 * Local deployment profile
 *
 * Profile for local Docker/Podman deployment
 */
export interface LocalDeploymentProfile extends Omit<BaseDeploymentProfile, 'services'> {
  readonly target: 'local';

  /**
   * Services to deploy (using LocalServiceConfig where resources are optional)
   */
  readonly services: Readonly<Record<string, LocalServiceConfig>>;

  /**
   * Container engine
   */
  readonly engine: ContainerEngine;

  /**
   * Docker network name
   */
  readonly network?: string;
}

/**
 * Akash placement attributes for geographic targeting
 *
 * Based on **actual provider usage** on Akash mainnet (not the official schema).
 * Only includes attributes that providers actually use and advertise.
 *
 * **Available Attributes:**
 * - `region`: Geographic location (33 providers use this)
 * - `tier`: Provider quality level (37 providers use this)
 *
 * @example
 * ```typescript
 * // Deploy to premium providers in Central US
 * const placement: AkashPlacementAttributes = {
 *   region: 'us-central',
 *   tier: 'premium'
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Deploy to community providers in Europe (cost-optimized)
 * const placement: AkashPlacementAttributes = {
 *   region: 'eu-central',
 *   tier: 'community'
 * };
 * ```
 */
export interface AkashPlacementAttributes {
  /**
   * Geographic region
   *
   * Providers advertise their 'region' attribute to indicate location.
   * 33 providers use this attribute.
   *
   * **Most Common Regions:**
   * - 'us-west': Western US (5 providers)
   * - 'us-central': Central US/Texas (4 providers)
   * - 'us-east': Eastern US (3 providers)
   * - 'eu-central': Central Europe (2 providers)
   *
   * @example 'us-west' for Western United States
   * @example 'us-central' for Central US / Texas area
   * @example 'eu-central' for Central Europe
   */
  readonly region?: AkashRegion;

  /**
   * Provider tier classification
   *
   * Indicates service level and reliability.
   * 37 providers advertise this attribute.
   *
   * **Provider Tiers:**
   * - 'community': Standard community providers (35 providers)
   * - 'premium': Premium providers with higher SLAs (2 providers)
   *
   * @example 'premium' for production workloads
   * @example 'community' for development/testing
   */
  readonly tier?: AkashTier;
}

/**
 * Akash deployment profile
 *
 * Profile for Akash Network deployment
 */
export interface AkashDeploymentProfile extends Omit<BaseDeploymentProfile, 'services'> {
  readonly target: 'akash';

  /**
   * Services to deploy (using AkashServiceConfig where cpu/memory are required)
   */
  readonly services: Readonly<Record<string, AkashServiceConfig>>;

  /**
   * Akash network
   */
  readonly network: Network;

  /**
   * Path to certificate file
   */
  readonly cert?: string;

  /**
   * Use remote container registry
   */
  readonly useRemoteRegistry?: boolean;

  /**
   * Provider blacklist
   */
  readonly blacklist?: readonly string[];

  /**
   * Maximum price per block
   */
  readonly maxPrice?: number;

  /**
   * Deployment deposit
   */
  readonly deposit?: number;

  /**
   * Pricing configuration per service
   *
   * Maps service name to pricing config
   */
  readonly pricing?: Readonly<
    Record<
      string,
      {
        readonly amount: string;
        readonly denom: 'uakt' | 'akt';
      }
    >
  >;

  /**
   * Geographic and facility placement constraints
   *
   * Specify where your deployment should run using **actual provider attributes**
   * from Akash mainnet. All fields are optional - only specify what matters.
   *
   * **Most Effective Attributes:**
   * - `region`: Geographic location (us-west, us-central, eu-central) - 33 providers use this
   * - `tier`: Provider quality level (community, premium) - 37 providers use this
   *
   * **Less Effective Attributes:**
   * - `location-type`: Only 7 providers advertise this
   * - `timezone`: Rarely used by providers
   * - `country`, `city`: Inconsistently formatted
   *
   * **Recommendation:** Start with `region` and/or `tier` for best results.
   *
   * @example
   * ```typescript
   * // Deploy to premium providers in Central US (Dallas/Texas area)
   * placement: {
   *   region: 'us-central',
   *   tier: 'premium'
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Deploy to community providers in EU (cost-optimized)
   * placement: {
   *   region: 'eu-central',
   *   tier: 'community'
   * }
   * ```
   */
  readonly placement?: AkashPlacementAttributes;

  /**
   * Provider placement constraints (legacy/advanced)
   *
   * Generic provider attributes for advanced filtering.
   * For geographic targeting, prefer using the `placement` field instead.
   *
   * This field is for custom provider attributes not covered by placement.
   */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;

  /**
   * Auditor signature requirements
   *
   * Provider attributes must be signed by these auditors
   */
  readonly signedBy?: {
    readonly allOf?: readonly string[];
    readonly anyOf?: readonly string[];
  };
}

/**
 * Deployment profile union type
 *
 * Can be either local or Akash profile
 */
export type DeploymentProfile =
  | LocalDeploymentProfile
  | AkashDeploymentProfile;

/**
 * Loaded deployment profile with metadata
 *
 * Represents a profile that has been loaded and resolved from agent.json
 *
 * @template TProfile - The specific profile type
 */
export interface LoadedProfile<TProfile extends DeploymentProfile> {
  /**
   * Profile name (key from agent.json)
   */
  readonly name: string;

  /**
   * Profile configuration
   */
  readonly profile: TProfile;

  /**
   * Agent configuration source
   */
  readonly agent: AgentConfig;

  /**
   * Project root directory
   */
  readonly projectRoot: string;
}

/**
 * Type guard to check if profile is for local deployment
 *
 * @param profile - The profile to check
 * @returns True if profile targets local deployment
 */
export function isLocalProfile(
  profile: DeploymentProfile
): profile is LocalDeploymentProfile {
  return profile.target === 'local';
}

/**
 * Type guard to check if profile is for Akash deployment
 *
 * @param profile - The profile to check
 * @returns True if profile targets Akash deployment
 */
export function isAkashProfile(
  profile: DeploymentProfile
): profile is AkashDeploymentProfile {
  return profile.target === 'akash';
}
