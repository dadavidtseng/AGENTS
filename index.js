#!/usr/bin/env node

/**
 * ability-deploy — Unified Deployment Ability
 *
 * Tools:
 *   Deployment: deploy_to_akash, deploy_to_local
 *   Registry:   start_registry, stop_registry, add_container, remove_container,
 *               list_containers, get_registry_urls, get_docker_commands, get_registry_status
 */

import dotenv from 'dotenv';
dotenv.config();

import { pathToFileURL } from 'url';
import { KadiClient, z } from '@kadi.build/core';
import { deployToAkash, deployToLocal } from './dist/index.js';
import { TunneledContainerRegistry } from './src/registry/TunneledContainerRegistry.js';

const client = new KadiClient({
  name: 'ability-deploy',
  version: '0.2.0',
  description: 'Deployment operations (Akash Network, local Docker) + container registry management',
  role: 'ability',
  ...(process.env.KADI_BROKER_URL && {
    brokers: {
      default: {
        url: process.env.KADI_BROKER_URL,
        ...(process.env.KADI_NETWORK && {
          networks: [process.env.KADI_NETWORK]
        })
      }
    }
  })
});

// ============================================================================
// DEPLOYMENT OPERATIONS
// ============================================================================

// 1. Deploy to Akash Network
client.registerTool({
  name: 'deploy_to_akash',
  description: 'Deploy application to Akash Network decentralized cloud platform',
  input: z.object({
    projectRoot: z.string().describe('Project root directory path'),
    profile: z.string().default('production').describe('Deployment profile name'),
    dryRun: z.boolean().default(false).describe('Perform dry run without actual deployment'),
    monitorReadiness: z.boolean().default(true).describe('Monitor container readiness after deployment'),
    blacklistProviders: z.array(z.string()).optional().describe('Provider addresses to blacklist'),
    whitelistProviders: z.array(z.string()).optional().describe('Provider addresses to whitelist'),
    maxBidPrice: z.string().optional().describe('Maximum bid price in uakt'),
    minMemory: z.string().optional().describe('Minimum memory requirement (e.g., "512Mi")'),
    minStorage: z.string().optional().describe('Minimum storage requirement (e.g., "1Gi")')
  }),
  output: z.object({
    success: z.boolean().describe('Whether deployment succeeded'),
    data: z.any().optional().describe('Deployment data (dseq, provider, lease info)'),
    error: z.string().optional().describe('Error message if failed')
  })
}, async (params) => {
  try {
    const result = await deployToAkash(params);
    
    if (result.success) {
      return {
        success: true,
        data: result.data
      };
    } else {
      return {
        success: false,
        error: result.error?.message || 'Unknown deployment error'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Deployment failed with exception'
    };
  }
});

// 2. Deploy to local Docker
client.registerTool({
  name: 'deploy_to_local',
  description: 'Deploy application to local Docker environment for development and testing',
  input: z.object({
    projectRoot: z.string().describe('Project root directory path'),
    profile: z.string().default('local-dev').describe('Deployment profile name'),
    engine: z.enum(['docker', 'podman']).default('docker').describe('Container engine to use'),
    recreate: z.boolean().default(false).describe('Force recreate containers'),
    build: z.boolean().default(true).describe('Build images before deploying'),
    detach: z.boolean().default(true).describe('Run in detached mode')
  }),
  output: z.object({
    success: z.boolean().describe('Whether deployment succeeded'),
    data: z.any().optional().describe('Deployment data (services, endpoints, networks)'),
    error: z.string().optional().describe('Error message if failed')
  })
}, async (params) => {
  try {
    const result = await deployToLocal(params);
    
    if (result.success) {
      return {
        success: true,
        data: result.data
      };
    } else {
      return {
        success: false,
        error: result.error?.message || 'Unknown deployment error'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Deployment failed with exception'
    };
  }
});

// ============================================================================
// CONTAINER REGISTRY OPERATIONS
// ============================================================================

// Shared registry instance
let registry = null;

/**
 * Get or create registry instance
 */
function getRegistry(options = {}) {
  if (!registry) {
    const defaultOptions = {
      port: parseInt(process.env.CONTAINER_REGISTRY_PORT || '0', 10),
      tunnelService: process.env.CONTAINER_REGISTRY_TUNNEL_SERVICE || 'serveo',
      preferredEngine: process.env.CONTAINER_REGISTRY_ENGINE || 'auto',
      enableAnalytics: process.env.CONTAINER_REGISTRY_ANALYTICS !== 'false',
      downloadTracking: process.env.CONTAINER_REGISTRY_DOWNLOAD_TRACKING !== 'false',
      enableLogging: process.env.CONTAINER_REGISTRY_LOGGING !== 'false'
    };
    registry = new TunneledContainerRegistry({
      ...defaultOptions,
      ...options
    });
  }
  return registry;
}

// 3. Start registry
client.registerTool({
  name: 'start_registry',
  description: 'Start the container registry with optional public tunnel',
  input: z.object({
    port: z.number().optional().describe('Local server port (0 = random)'),
    tunnelService: z.enum(['serveo', 'ngrok', 'localtunnel', 'none']).optional().describe('Tunnel service to use'),
    preferredEngine: z.enum(['docker', 'podman', 'auto']).optional().describe('Preferred container engine')
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    publicUrl: z.string().optional().describe('Public tunnel URL'),
    localUrl: z.string().optional().describe('Local registry URL'),
    port: z.number().optional().describe('Local server port'),
    engine: z.string().optional().describe('Container engine in use'),
    message: z.string().describe('Success message or error details')
  })
}, async ({ port, tunnelService, preferredEngine }) => {
  try {
    const reg = getRegistry({ port, tunnelService, preferredEngine });
    await reg.start();
    const urls = await reg.getRegistryUrls();
    const info = reg.getRegistryInfo();
    return {
      success: true,
      publicUrl: urls.tunnelUrl,
      localUrl: urls.localUrl,
      port: info.port,
      engine: info.containerEngine,
      message: `Registry started successfully${urls.tunnelUrl ? ` with public access at ${urls.tunnelUrl}` : ''}`
    };
  } catch (error) {
    return { success: false, message: `Failed to start registry: ${error.message}` };
  }
});

// 4. Stop registry
client.registerTool({
  name: 'stop_registry',
  description: 'Stop the container registry and cleanup resources',
  input: z.object({}),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    message: z.string().describe('Success message or error details')
  })
}, async () => {
  try {
    if (!registry) {
      return { success: true, message: 'Registry is not running' };
    }
    await registry.stop();
    registry = null;
    return { success: true, message: 'Registry stopped successfully' };
  } catch (error) {
    return { success: false, message: `Failed to stop registry: ${error.message}` };
  }
});

// 5. Add container
client.registerTool({
  name: 'add_container',
  description: 'Add a container to the registry for sharing',
  input: z.object({
    name: z.string().describe('Container name (e.g., "nginx:latest")'),
    type: z.enum(['docker', 'podman', 'tar', 'mock']).optional().default('docker').describe('Container type'),
    image: z.string().optional().describe('Container image name (for docker/podman)'),
    tarPath: z.string().optional().describe('Path to tar file (for tar type)')
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    alias: z.string().optional().describe('Container alias in registry'),
    originalName: z.string().optional().describe('Original container name'),
    type: z.string().optional().describe('Container type'),
    layers: z.number().optional().describe('Number of layers'),
    message: z.string().describe('Success message or error details')
  })
}, async ({ name, type, image, tarPath }) => {
  try {
    if (!registry) {
      return { success: false, message: 'Registry is not running. Please start the registry first.' };
    }
    const containerSpec = {
      type: type || 'docker',
      name,
      ...(image && { image }),
      ...(tarPath && { tarPath })
    };
    const result = await registry.addContainer(containerSpec);
    return {
      success: true,
      alias: result.alias,
      originalName: result.originalName,
      type: result.type,
      layers: result.layers?.length,
      message: `Container "${name}" added successfully as "${result.alias}"`
    };
  } catch (error) {
    return { success: false, message: `Failed to add container: ${error.message}` };
  }
});

// 6. Remove container
client.registerTool({
  name: 'remove_container',
  description: 'Remove a container from the registry',
  input: z.object({
    containerId: z.string().describe('Container alias or ID to remove')
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    message: z.string().describe('Success message or error details')
  })
}, async ({ containerId }) => {
  try {
    if (!registry) {
      return { success: false, message: 'Registry is not running' };
    }
    await registry.removeContainer(containerId);
    return { success: true, message: `Container "${containerId}" removed successfully` };
  } catch (error) {
    return { success: false, message: `Failed to remove container: ${error.message}` };
  }
});

// 7. List containers
client.registerTool({
  name: 'list_containers',
  description: 'List all containers in the registry',
  input: z.object({}),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    containers: z.array(z.object({
      alias: z.string(),
      originalName: z.string(),
      type: z.string(),
      addedAt: z.string()
    })).optional().describe('List of containers'),
    count: z.number().optional().describe('Number of containers'),
    message: z.string().describe('Success message or error details')
  })
}, async () => {
  try {
    if (!registry) {
      return { success: true, containers: [], count: 0, message: 'Registry is not running' };
    }
    const info = registry.getRegistryInfo();
    const containers = Array.from(info.containers.values()).map(c => ({
      alias: c.alias,
      originalName: c.originalName,
      type: c.type,
      addedAt: c.addedAt
    }));
    return {
      success: true,
      containers,
      count: containers.length,
      message: `Found ${containers.length} container(s)`
    };
  } catch (error) {
    return { success: false, message: `Failed to list containers: ${error.message}` };
  }
});

// 8. Get registry URLs
client.registerTool({
  name: 'get_registry_urls',
  description: 'Get registry access URLs (public and local)',
  input: z.object({}),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    publicUrl: z.string().optional().describe('Public tunnel URL'),
    localUrl: z.string().optional().describe('Local registry URL'),
    tunnelType: z.string().optional().describe('Tunnel service type'),
    message: z.string().describe('Success message or error details')
  })
}, async () => {
  try {
    if (!registry) {
      return { success: false, message: 'Registry is not running' };
    }
    const urls = await registry.getRegistryUrls();
    return {
      success: true,
      publicUrl: urls.tunnelUrl,
      localUrl: urls.localUrl,
      tunnelType: urls.tunnelType,
      message: 'Registry URLs retrieved successfully'
    };
  } catch (error) {
    return { success: false, message: `Failed to get registry URLs: ${error.message}` };
  }
});

// 9. Get Docker commands
client.registerTool({
  name: 'get_docker_commands',
  description: 'Get Docker/Podman commands for accessing the registry',
  input: z.object({
    containerName: z.string().optional().describe('Container alias (optional, returns all if not specified)')
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    loginCommands: z.object({
      docker: z.string().optional(),
      podman: z.string().optional()
    }).optional().describe('Login commands'),
    pullCommands: z.record(z.string(), z.object({
      docker: z.string(),
      podman: z.string()
    })).optional().describe('Pull commands for each container'),
    oneLineCommands: z.record(z.string(), z.object({
      docker: z.string(),
      podman: z.string()
    })).optional().describe('One-line commands (login + pull + run)'),
    message: z.string().describe('Success message or error details')
  })
}, async ({ containerName }) => {
  try {
    if (!registry) {
      return { success: false, message: 'Registry is not running' };
    }
    const commands = await registry.getDockerCommands(containerName);
    return {
      success: true,
      loginCommands: commands.loginCommands,
      pullCommands: commands.pullCommands,
      oneLineCommands: commands.oneLineCommands,
      message: 'Docker commands generated successfully'
    };
  } catch (error) {
    return { success: false, message: `Failed to get Docker commands: ${error.message}` };
  }
});

// 10. Get registry status
client.registerTool({
  name: 'get_registry_status',
  description: 'Get current registry status and information',
  input: z.object({}),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    state: z.string().optional().describe('Registry state (running, stopped, etc)'),
    port: z.number().optional().describe('Local server port'),
    containerCount: z.number().optional().describe('Number of containers'),
    engine: z.string().optional().describe('Container engine in use'),
    tunnelActive: z.boolean().optional().describe('Whether tunnel is active'),
    message: z.string().describe('Success message or error details')
  })
}, async () => {
  try {
    if (!registry) {
      return { success: true, state: 'stopped', containerCount: 0, tunnelActive: false, message: 'Registry is not running' };
    }
    const info = registry.getRegistryInfo();
    return {
      success: true,
      state: info.state,
      port: info.port,
      containerCount: info.containers.size,
      engine: info.containerEngine,
      tunnelActive: info.tunnelActive || false,
      message: 'Registry status retrieved successfully'
    };
  } catch (error) {
    return { success: false, message: `Failed to get registry status: ${error.message}` };
  }
});

// ============================================================================
// CLEANUP HANDLER
// ============================================================================

async function cleanup() {
  if (registry) {
    try {
      await registry.stop();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });

// Export the KadiClient instance
export default client;

// Auto-serve when run directly
// Use pathToFileURL for Windows compatibility
const scriptPath = pathToFileURL(process.argv[1]).href;

if (import.meta.url === scriptPath) {
  const mode = (process.env.KADI_MODE || 'stdio');

  // IMPORTANT: In stdio mode, stdout is reserved for JSON-RPC protocol
  // Log to stderr instead to avoid corrupting the stdio message stream
  if (mode === 'stdio') {
    console.error(`[ability-deploy] Starting in ${mode} mode...`);
  } else {
    console.log(`[ability-deploy] Starting in ${mode} mode...`);
  }

  client.serve(mode).catch((error) => {
    console.error(`Failed to start ability server in ${mode} mode:`, error);
    process.exit(1);
  });
}
