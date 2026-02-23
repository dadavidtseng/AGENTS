import 'dotenv/config';
import { BaseAgent, logger, MODULE_AGENT, timer } from 'agents-library';
import type { BaseAgentConfig, AgentRole } from 'agents-library';
import { setupTaskReceptionHandler } from './handlers/task-reception.js';
import { setupTaskVerificationHandler } from './handlers/task-verification.js';
import { setupPrWorkflowHandler } from './handlers/pr-workflow.js';
import { setupPrPollingHandler } from './handlers/pr-polling.js';

// Role-based network mapping
const ROLE_NETWORKS: Record<string, string[]> = {
  artist: ['producer', 'artist', 'git', 'qa'],
  designer: ['producer', 'designer', 'git', 'qa'],
  programmer: ['producer', 'programmer', 'git', 'qa', 'deploy'],
};

const VALID_ROLES = ['artist', 'designer', 'programmer'];

const role = process.env.AGENT_ROLE ?? 'programmer';
if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid AGENT_ROLE: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}

const agentName = `agent-lead-${role}`;
const networks = ROLE_NETWORKS[role];
const brokerUrl = process.env.KADI_BROKER_URL ?? 'ws://localhost:8080/kadi';

// ============================================================================
// BaseAgent Instance
// ============================================================================

const baseAgentConfig: BaseAgentConfig = {
  agentId: agentName,
  agentRole: role as AgentRole,
  version: '1.0.0',
  brokerUrl,
  networks,
};

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

  // TODO: Register event handlers (task 4.10+)

  // Task 4.10 + 4.11: Subscribe to quest.tasks_ready and dispatch tasks to workers
  await setupTaskReceptionHandler(client, role, agentName);

  // Task 4.12: Subscribe to task.completed and task.failed for verification
  await setupTaskVerificationHandler(client, role, agentName);

  // Task 4.14: Subscribe to quest.verification_complete for PR creation
  await setupPrWorkflowHandler(client, role, agentName);

  // Task 4.33: PR status polling fallback (when webhook is unavailable)
  await setupPrPollingHandler(client, role, agentName);

  logger.info(MODULE_AGENT, `${agentName} ready`, timer.elapsed('main'));
}

main().catch((err) => {
  logger.error(MODULE_AGENT, `Fatal error: ${err}`, timer.elapsed('main'));
  process.exit(1);
});
