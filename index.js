#!/usr/bin/env node

/**
 * Deploy Ability - KadiClient Wrapped
 *
 * Provides deployment operations (Akash Network, local Docker)
 * wrapped in KadiClient for native/stdio/broker transport compatibility.
 */

// Load environment variables from .env file (ESM style)
import dotenv from 'dotenv';
dotenv.config();

import { pathToFileURL } from 'url';
import { KadiClient, z } from '@kadi.build/core';
import { deployToAkash, deployToLocal } from './dist/index.js';

// Debug: Log environment variables
console.error('[DEBUG] KADI_MODE:', process.env.KADI_MODE);
console.error('[DEBUG] KADI_BROKER_URL:', process.env.KADI_BROKER_URL);

// Create KadiClient instance with broker configuration
const clientConfig = {
  name: 'deploy-ability',
  version: '1.0.0',
  description: 'Deployment operations (Akash Network, local Docker)',
  role: 'ability'
};

// Add broker configuration if KADI_BROKER_URL is set
if (process.env.KADI_BROKER_URL) {
  console.error('[DEBUG] Adding broker config:', process.env.KADI_BROKER_URL);
  clientConfig.broker = process.env.KADI_BROKER_URL;
} else {
  console.error('[DEBUG] No KADI_BROKER_URL found!');
}

const client = new KadiClient(clientConfig);

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
    console.error(`[deploy-ability] Starting in ${mode} mode...`);
  } else {
    console.log(`[deploy-ability] Starting in ${mode} mode...`);
  }

  client.serve(mode).catch((error) => {
    console.error(`Failed to start ability server in ${mode} mode:`, error);
    process.exit(1);
  });
}
