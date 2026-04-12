/**
 * QA Agent for KĀDI Protocol
 * ============================
 *
 * Automated testing, code review, and quality verification agent.
 *
 * Architecture:
 * - BaseAgent provides KadiClient + ProviderManager + MemoryService
 * - Subscribes to task.review_requested events
 * - Optional LLM enhancement for semantic code review
 *
 * @module agent-qa
 */

import {
  BaseAgent,
  loadVaultCredentials,
  readConfig,
  setLogLevel,
  setAgentTag,
  logger,
  timer,
} from 'agents-library';
import type { BaseAgentConfig } from 'agents-library';
import { setupValidationHandler } from './handlers/validation.js';

const cfg = readConfig();

// ============================================================================
// Agent identity + logging
// ============================================================================

const agentId = cfg.string('agent.ID');
const agentVersion = cfg.string('agent.VERSION');
const logLevel = cfg.has('logging.LEVEL') ? cfg.string('logging.LEVEL') : 'info';
setLogLevel(logLevel);
setAgentTag(agentId);

// ============================================================================
// Configuration
// ============================================================================

// Broker resolution: at least one of local/remote required
const hasLocal = cfg.has('broker.local.URL');
const hasRemote = cfg.has('broker.remote.URL');
if (!hasLocal && !hasRemote) {
  throw new Error('At least one broker required: set [broker.local] or [broker.remote] in config.toml');
}

const brokerUrl = hasLocal
  ? (process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL'))
  : (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'));
const networks = hasLocal
  ? cfg.strings('broker.local.NETWORKS')
  : cfg.strings('broker.remote.NETWORKS');

const additionalBrokerUrl = hasLocal && hasRemote
  ? (process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL'))
  : undefined;
const additionalBrokerNetworks = hasLocal && hasRemote
  ? cfg.strings('broker.remote.NETWORKS')
  : undefined;

// Provider config
const primaryProvider = cfg.has('provider.PRIMARY') ? cfg.string('provider.PRIMARY') : undefined;
const fallbackProvider = cfg.has('provider.FALLBACK') ? cfg.string('provider.FALLBACK') : undefined;

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  timer.start('main');

  // Startup summary
  logger.info(agentId, `Starting ${agentId} v${agentVersion}`, timer.elapsed('main'));
  const brokerSummary = [
    hasLocal ? `local=${process.env.KADI_BROKER_URL_LOCAL ?? cfg.string('broker.local.URL')}` : null,
    hasRemote ? `remote=${process.env.KADI_BROKER_URL_REMOTE ?? cfg.string('broker.remote.URL')}` : null,
  ].filter(Boolean).join(', ');
  logger.info(agentId, `Broker: ${brokerSummary}`, timer.elapsed('main'));
  logger.info(agentId, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));
  if (primaryProvider) {
    const primaryModel = cfg.string(`provider.${primaryProvider}.MODEL`);
    const fallbackModel = fallbackProvider ? cfg.string(`provider.${fallbackProvider}.MODEL`) : undefined;
    logger.info(agentId, `LLM: ${primaryProvider}/${primaryModel}${fallbackProvider ? ` (fallback: ${fallbackProvider}/${fallbackModel})` : ''}`, timer.elapsed('main'));
  }

  // Load credentials: env vars take priority over vault
  const vault = await loadVaultCredentials();
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || vault.ANTHROPIC_API_KEY;
  const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL || vault.MODEL_MANAGER_BASE_URL;
  const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY || vault.MODEL_MANAGER_API_KEY;

  // Build BaseAgent config
  const baseAgentConfig: BaseAgentConfig = {
    agentId,
    agentRole: 'programmer',
    version: agentVersion,
    brokerUrl,
    networks,
    ...(additionalBrokerUrl ? {
      additionalBrokers: {
        remote: { url: additionalBrokerUrl, networks: additionalBrokerNetworks! },
      },
    } : {}),
    ...((anthropicApiKey || (modelManagerBaseUrl && modelManagerApiKey)) ? {
      provider: {
        ...(anthropicApiKey ? { anthropicApiKey } : {}),
        ...(modelManagerBaseUrl && modelManagerApiKey ? {
          modelManagerBaseUrl,
          modelManagerApiKey,
        } : {}),
        ...(primaryProvider ? { primaryProvider } : {}),
        ...(fallbackProvider ? { fallbackProvider } : {}),
      },
    } : {}),
    memory: {
      dataPath: process.env.MEMORY_DATA_PATH ?? cfg.string('memory.DATA_PATH'),
    },
  };

  const baseAgent = new BaseAgent(baseAgentConfig);
  await baseAgent.connect();

  // Load ability-file-local natively (zero-latency file ops, in-process)
  let nativeFileLocal: any = null;
  try {
    nativeFileLocal = await baseAgent.client.loadNative('ability-file-local');
    logger.info(agentId, 'Loaded ability-file-local natively', timer.elapsed('main'));
  } catch (err: any) {
    logger.warn(agentId, `Could not load ability-file-local natively: ${err.message}`, timer.elapsed('main'));
  }

  // Load ability-eval natively (zero-latency code/task evaluation, in-process)
  let nativeEval: any = null;
  try {
    nativeEval = await baseAgent.client.loadNative('ability-eval');
    logger.info(agentId, 'Loaded ability-eval natively', timer.elapsed('main'));
  } catch (err: any) {
    logger.warn(agentId, `Could not load ability-eval natively: ${err.message}`, timer.elapsed('main'));
  }

  // Load ability-vision natively (zero-latency image analysis, in-process)
  let nativeVision: any = null;
  try {
    nativeVision = await baseAgent.client.loadNative('ability-vision');
    logger.info(agentId, 'Loaded ability-vision natively', timer.elapsed('main'));
  } catch (err: any) {
    logger.warn(agentId, `Could not load ability-vision natively: ${err.message}`, timer.elapsed('main'));
  }

  // Load ability-file-remote natively (zero-latency remote file ops, in-process)
  let nativeFileRemote: any = null;
  try {
    nativeFileRemote = await baseAgent.client.loadNative('ability-file-remote');
    logger.info(agentId, 'Loaded ability-file-remote natively', timer.elapsed('main'));
  } catch (err: any) {
    logger.warn(agentId, `Could not load ability-file-remote natively: ${err.message}`, timer.elapsed('main'));
  }

  const client = baseAgent.client;

  // Register validation handler (subscribes to task.review_requested)
  setupValidationHandler(client, baseAgent.providerManager, baseAgent.memoryService, nativeFileLocal, nativeEval, nativeVision, null /* file-cloud via broker */, nativeFileRemote);

  if (baseAgent.providerManager) {
    logger.info(agentId, 'LLM semantic review enabled', timer.elapsed('main'));
  } else {
    logger.warn(agentId, 'No LLM provider — heuristic-only scoring', timer.elapsed('main'));
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(agentId, `${signal} received, shutting down...`, timer.elapsed('main'));
    await baseAgent.shutdown();
    logger.info(agentId, 'Shutdown complete', timer.elapsed('main'));
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info(agentId, `Ready (${timer.elapsed('main')})`, timer.elapsed('main'));
}

main().catch((err) => {
  logger.error(agentId, `Fatal error: ${err}`, '+0ms');
  process.exit(1);
});
