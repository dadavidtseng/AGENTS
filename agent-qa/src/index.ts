import 'dotenv/config';
import { BaseAgent, logger, MODULE_AGENT, timer } from 'agents-library';
import type { BaseAgentConfig } from 'agents-library';
import { setupValidationHandler } from './handlers/validation.js';

const agentName = 'agent-qa';
const networks = (process.env.KADI_NETWORK ?? 'qa,eval,vision').split(',').map((n) => n.trim());
const brokerUrl = process.env.KADI_BROKER_URL ?? 'ws://localhost:8080/kadi';

// ============================================================================
// BaseAgent Instance
// ============================================================================

const baseAgentConfig: BaseAgentConfig = {
  agentId: agentName,
  agentRole: 'programmer',
  version: '1.0.0',
  brokerUrl,
  networks,
  // LLM provider for semantic code review (optional — falls back to heuristic-only if unset)
  ...buildProviderConfig(),
  // Memory for recalling past QA patterns
  memory: {
    dataPath: process.env.MEMORY_DATA_PATH || './data/memory',
  },
};

/** Build provider config from env vars. Model Manager is primary, Anthropic is fallback. */
function buildProviderConfig(): { provider: BaseAgentConfig['provider'] } | Record<string, never> {
  const modelManagerBaseUrl = process.env.MODEL_MANAGER_BASE_URL;
  const modelManagerApiKey = process.env.MODEL_MANAGER_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (modelManagerBaseUrl && modelManagerApiKey) {
    return {
      provider: {
        modelManagerBaseUrl,
        modelManagerApiKey,
        primaryProvider: 'model-manager',
        ...(anthropicApiKey && {
          anthropicApiKey,
          fallbackProvider: 'anthropic',
        }),
      },
    };
  }

  if (anthropicApiKey) {
    return {
      provider: {
        anthropicApiKey,
        primaryProvider: 'anthropic',
      },
    };
  }

  return {};
}

const baseAgent = new BaseAgent(baseAgentConfig);
/** Convenience alias — used by event handlers registered in later tasks */
export const client = baseAgent.client;

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  timer.start('main');

  logger.info(MODULE_AGENT, `Starting ${agentName}`, timer.elapsed('main'));
  logger.info(MODULE_AGENT, `Networks: ${networks.join(', ')}`, timer.elapsed('main'));

  await baseAgent.connect();
  logger.info(MODULE_AGENT, `Connected to broker at ${brokerUrl}`, timer.elapsed('main'));

  // Register validation handler (subscribes to task.review_requested)
  // Pass providerManager and memoryService to enable LLM-based semantic review + past pattern recall
  setupValidationHandler(client, baseAgent.providerManager, baseAgent.memoryService);

  if (baseAgent.providerManager) {
    const primary = process.env.MODEL_MANAGER_BASE_URL ? 'Model Manager' : 'Anthropic';
    logger.info(MODULE_AGENT, `LLM semantic review enabled (primary: ${primary})`, timer.elapsed('main'));
  } else {
    logger.warn(MODULE_AGENT, 'No LLM provider configured — semantic review disabled, using heuristic-only scoring', timer.elapsed('main'));
  }

  logger.info(MODULE_AGENT, `${agentName} ready`, timer.elapsed('main'));
}

main().catch((err) => {
  logger.error(MODULE_AGENT, `Fatal error: ${err}`, timer.elapsed('main'));
  process.exit(1);
});
