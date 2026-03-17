/**
 * Akash SDL Generator
 *
 * Transforms a loaded Akash deployment profile into an SDL (Stack Definition
 * Language) document that can be submitted to the Akash blockchain and
 * providers. The generator mirrors the logic from the legacy kadi-deploy
 * implementation, but is rewritten for clarity and type safety.
 *
 * @module targets/akash/sdl-generator
 */

import yaml from 'js-yaml';
import { SDL } from '@akashnetwork/chain-sdk';

import type { LoadedProfile, AkashDeploymentProfile } from '../../types/index.js';
import type {
  BaseServiceConfig,
  EnvironmentVariable,
  PortExposure,
  PersistentVolumeSpec,
} from '../../types/common.js';

/**
 * Generation options allowing the caller to override resource/pricing defaults
 */
export interface AkashSdlGenerationOptions {
  readonly defaultCpuUnits?: number;
  readonly defaultMemorySize?: string;
  readonly defaultStorageSize?: string;
  readonly defaultPricingDenom?: string;
  readonly defaultPricingAmount?: number;
}

/**
 * Generates Akash SDL YAML string from a loaded deployment profile.
 */
export function generateAkashSdl(
  loadedProfile: LoadedProfile<AkashDeploymentProfile>,
  options: AkashSdlGenerationOptions = {}
): string {
  const defaults = {
    defaultCpuUnits: 0.5,
    defaultMemorySize: '512Mi',
    defaultStorageSize: '1Gi',
    defaultPricingDenom: 'uakt',
    defaultPricingAmount: 1000,
    ...options,
  };

  const services: Record<string, Record<string, unknown>> = {};
  const computeProfiles: Record<string, Record<string, unknown>> = {};

  // Build placement profile with attributes and signedBy from profile
  const akashProfile = loadedProfile.profile;

  // Merge placement attributes with any existing attributes
  // Placement attributes control where the deployment runs (geographic targeting)
  //
  // **Important:** The 'placement' field provides type-safe convenience for common
  // attributes, but it maps to the actual provider attribute names that providers
  // use on mainnet (e.g., 'region' not 'location-region').
  const placementAttributes: Record<string, unknown> = {
    ...akashProfile.attributes,  // Existing attributes (GPU requirements, etc.)
  };

  // Add placement attributes if specified
  // Maps typed placement fields to actual provider attribute names
  if (akashProfile.placement) {
    if (akashProfile.placement.region) {
      placementAttributes.region = akashProfile.placement.region;
    }
    if (akashProfile.placement.tier) {
      placementAttributes.tier = akashProfile.placement.tier;
    }
  }

  const placementProfiles: {
    global: {
      attributes?: Record<string, unknown>;
      signedBy: { allOf?: readonly string[]; anyOf?: readonly string[] };
      pricing: Record<string, { denom: string; amount: number | string }>;
    };
  } = {
    global: {
      attributes: placementAttributes,
      signedBy: akashProfile.signedBy || {
        allOf: ['akash1365yvmc4s7awdyj3n2sav7xfx76adc6dnmlx63'],
      },
      pricing: {},
    },
  };

  const deploymentProfiles: Record<string, Record<string, unknown>> = {};

  for (const [serviceName, serviceConfig] of Object.entries(
    loadedProfile.profile.services
  )) {
    const akashServiceName = normaliseServiceName(serviceName);

    // Support pricing at both profile level and service level
    const pricing = loadedProfile.profile.pricing?.[serviceName] ?? (serviceConfig as any).pricing;

    services[akashServiceName] = buildServiceSection(serviceConfig);
    computeProfiles[akashServiceName] = buildComputeProfile(serviceConfig, defaults);
    placementProfiles.global.pricing[akashServiceName] = buildPricingProfile(pricing, defaults);
    deploymentProfiles[akashServiceName] = buildDeploymentProfile(
      akashServiceName,
      serviceConfig
    );
  }

  // Build SDL document in the conventional order:
  // 1. version
  // 2. services
  // 3. profiles (compute, placement)
  // 4. deployment

  // Clean up placement profile - remove attributes if empty
  const cleanPlacement = { ...placementProfiles };
  if (Object.keys(cleanPlacement.global.attributes || {}).length === 0) {
    delete cleanPlacement.global.attributes;
  }

  const sdlDocument = {
    version: '2.0',
    services,
    profiles: {
      compute: computeProfiles,
      placement: cleanPlacement,
    },
    deployment: deploymentProfiles,
  };

  return yaml.dump(sdlDocument, {
    noRefs: true,
    lineWidth: 120,
    indent: 2,
  });
}

/**
 * Generates SDL string and returns an instantiated SDL helper from chain-sdk.
 */
export function createSdlObject(
  loadedProfile: LoadedProfile<AkashDeploymentProfile>,
  options?: AkashSdlGenerationOptions
): SDL {
  const yamlString = generateAkashSdl(loadedProfile, options);
  return SDL.fromString(yamlString);
}

/**
 * Ensures service names are DNS-friendly (lowercase alphanumeric).
 */
function normaliseServiceName(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned || 'service';
}

/** Converts EnvironmentVariable definitions into KEY=value strings. */
function normaliseEnvironment(env?: readonly EnvironmentVariable[]): string[] | undefined {
  if (!env || env.length === 0) {
    return undefined;
  }

  const entries = env
    .map((variable) => {
      if (typeof variable === 'string') {
        return variable;
      }
      if (variable && typeof variable.name === 'string') {
        return `${variable.name}=${variable.value ?? ''}`;
      }
      return null;
    })
    .filter((value): value is string => value !== null);

  return entries.length > 0 ? entries : undefined;
}

/** Maps PortExposure definitions to Akash SDL format */
function normaliseExpose(expose?: readonly PortExposure[]): Array<Record<string, unknown>> | undefined {
  if (!expose || expose.length === 0) {
    return undefined;
  }

  return expose.map((exposure) => {
    const targets = exposure.to?.map((target) => {
      if (typeof target === 'string') {
        return { service: target };
      }
      if ('service' in target && target.service) {
        return { service: target.service };
      }
      return { global: (target as { global?: boolean }).global ?? false };
    });

    // Build base exposure object
    const exposureObj: Record<string, unknown> = {
      port: exposure.port,
      as: exposure.as ?? exposure.port,
      to: targets ?? [{ global: false }],
    };

    // Add HTTP options if specified
    // Only relevant for Akash deployments with global exposure
    if (exposure.http_options) {
      exposureObj.http_options = exposure.http_options;
    }

    return exposureObj;
  });
}


/** Builds services section entry. */
function buildServiceSection(service: BaseServiceConfig): Record<string, unknown> {
  const section: Record<string, unknown> = {
    image: service.image,
  };

  // Add registry credentials if present (for private registries)
  const credentials = (service as any).credentials;
  if (credentials) {
    section.credentials = credentials;
  }

  const env = normaliseEnvironment(service.env);
  if (env) section.env = env;

  if (service.command && service.command.length > 0) {
    section.command = service.command;
  }

  const expose = normaliseExpose(service.expose);
  if (expose) section.expose = expose;

  // Add params for persistent volume mounts
  const persistentVolumes = service.resources?.persistentVolumes ?? [];
  if (persistentVolumes.length > 0) {
    section.params = buildServiceParams(persistentVolumes);
  }

  return section;
}

/** Builds service params section for persistent volume mounts */
function buildServiceParams(
  volumes: readonly PersistentVolumeSpec[]
): Record<string, unknown> {
  const storage: Record<string, { mount: string }> = {};

  for (const volume of volumes) {
    storage[volume.name] = {
      mount: volume.mount,
    };
  }

  return { storage };
}

/** Builds compute profile for CPU/memory/storage/GPU requirements */
function buildComputeProfile(
  service: BaseServiceConfig,
  defaults: Required<AkashSdlGenerationOptions>
): Record<string, unknown> {
  const cpuUnits = service.resources?.cpu ?? defaults.defaultCpuUnits;
  const memory = service.resources?.memory ?? defaults.defaultMemorySize;
  const ephemeralSize = service.resources?.ephemeralStorage ?? defaults.defaultStorageSize;
  const persistentVolumes = service.resources?.persistentVolumes ?? [];

  const resources: Record<string, unknown> = {
    cpu: { units: cpuUnits },
    memory: { size: memory },
  };

  // Generate storage section
  if (persistentVolumes.length > 0) {
    // Array format: ephemeral + persistent volumes
    const storageArray: Array<Record<string, unknown>> = [
      { size: ephemeralSize },  // Ephemeral storage (first element)
    ];

    // Add each persistent volume with attributes
    for (const volume of persistentVolumes) {
      storageArray.push({
        name: volume.name,
        size: volume.size,
        attributes: {
          persistent: true,
          class: volume.class ?? 'beta2',  // Default to SSD if not specified
        },
      });
    }

    resources.storage = storageArray;
  } else {
    // Simple format: only ephemeral storage
    resources.storage = { size: ephemeralSize };
  }

  // Add GPU configuration if present
  if (service.resources?.gpu) {
    resources.gpu = service.resources.gpu;
  }

  return { resources };
}

/** Builds pricing profile (max bid per service). */
function buildPricingProfile(
  pricing: { amount: string; denom: 'uakt' | 'akt' } | undefined,
  defaults: Required<AkashSdlGenerationOptions>
): { denom: string; amount: number } {
  if (pricing) {
    return {
      denom: pricing.denom,
      amount: parseInt(pricing.amount, 10),  // Convert string to number
    };
  }

  return {
    denom: defaults.defaultPricingDenom,
    amount: defaults.defaultPricingAmount,
  };
}

/** Builds deployment profile specifying replica count. */
function buildDeploymentProfile(
  computeProfileName: string,
  _service: BaseServiceConfig  // Prefix unused param to avoid TS error
): Record<string, unknown> {
  const count = 1;

  return {
    global: {
      profile: computeProfileName,
      count,
    },
  };
}
