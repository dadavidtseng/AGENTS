/**
 * agents-library
 * ==============
 *
 * Shared utilities and factories for KĀDI multi-agent orchestration system.
 *
 * This package eliminates code duplication across worker agents, shadow agents,
 * and agent-producer by providing reusable factories, utilities, and type definitions.
 *
 * ## Exports
 *
 * ### Utilities
 * - **BaseBot** - Abstract base class with circuit breaker pattern and retry logic
 * - **KadiEventPublisher** - Event publishing utility for KĀDI broker with connection retry
 * - **validateTopicPattern** - Topic pattern validation for KĀDI broker
 *
 * ### Factories
 * - **WorkerAgentFactory** - Factory for creating worker agents (artist, designer, programmer)
 * - **BaseWorkerAgent** - Base class for worker agents with lifecycle management
 * - **createWorkerAgent** - Convenience function for worker agent creation
 * - **ShadowAgentFactory** - Factory for creating shadow backup agents
 * - **BaseShadowAgent** - Base class for shadow agents with filesystem and git monitoring
 * - **createShadowAgent** - Convenience function for shadow agent creation
 * - **ShadowAgentConfigSchema** - Zod schema for shadow agent configuration validation
 *
 * ### Producer Utilities
 * - **invokeShrimTool** - Invoke shrimp-task-manager tools via KĀDI protocol with retry logic
 * - **orchestrateWithClaude** - Claude API orchestration with tool invocation (Option C pattern)
 * - **publishToolEvent** - Standardized tool event publishing to KĀDI broker
 * - **classifyToolError** - Enhanced error classification for intelligent retry logic
 * - **isToolSuccess** - Type guard for successful tool invocations
 * - **isToolFailure** - Type guard for failed tool invocations
 *
 * ### Types
 *
 * #### Agent Configuration Types
 * - **AgentRole** - Union type for agent roles (artist, designer, programmer)
 * - **WorkerAgentConfig** - Configuration interface for worker agents
 * - **ShadowAgentConfig** - Configuration interface for shadow agents
 * - **WorkerBehaviors** - Custom behavior overrides for worker agents
 * - **PathConfig** - Path configuration for agent worktrees
 * - **NetworkConfig** - Network configuration for KĀDI broker
 *
 * #### Event Schema Types
 * - **TaskAssignedEvent** - Event schema for task assignments
 * - **TaskCompletedEvent** - Event schema for task completions
 * - **TaskFailedEvent** - Event schema for task failures
 * - **BackupEvent** - Event schema for shadow agent backups
 * - Event validation schemas and type guards
 *
 * #### Tool Schema Types
 * - **ErrorType** - Enum for error classification (transient, permanent)
 * - **ErrorClassification** - Detailed error classification with category and retry info
 * - **ToolSchema** - Tool definition interface for KĀDI tool registration
 * - **ToolInvocationSuccess** - Success result from tool invocation
 * - **ToolInvocationFailure** - Failure result from tool invocation
 * - **ToolInvocationResult** - Discriminated union for tool results
 * - **ToolInvocationParams** - Parameters for tool invocation via KĀDI protocol
 * - Tool validation schemas and type guards
 *
 * #### Producer Utility Types
 * - **InvokeOptions** - Options for invokeShrimTool
 * - **ShrimpToolResult** - Result structure for shrimp tool invocations
 * - **ToolDefinition** - Claude API tool definition
 * - **ToolInvocation** - Record of a tool invocation during orchestration
 * - **OrchestrationOptions** - Options for orchestrateWithClaude
 * - **OrchestrationResult** - Result from orchestrateWithClaude
 * - **EventMetadata** - Metadata for tool event publication
 *
 * @module agents-library
 */

// ============================================================================
// Utilities
// ============================================================================

export { BaseBot, BaseBotConfig } from './base-bot.js';
export { KadiEventPublisher, PublisherConfig, validateTopicPattern } from './kadi-event-publisher.js';
export { logger, MODULE_AGENT, MODULE_SLACK_BOT, MODULE_DISCORD_BOT, MODULE_TASK_HANDLER, MODULE_TOOLS } from './utils/logger.js';
export { timer, type Timer } from './utils/timer.js';
export {
  invokeShrimTool,
  isToolSuccess,
  isToolFailure,
  orchestrateWithClaude,
  publishToolEvent,
  type InvokeOptions,
  type ShrimpToolResult,
  type ToolDefinition,
  type ToolInvocation,
  type OrchestrationOptions,
  type OrchestrationResult,
  type EventMetadata
} from './producer-tool-utils.js';

// ============================================================================
// Factories
// ============================================================================

export {
  BaseWorkerAgent,
  WorkerAgentFactory,
  createWorkerAgent
} from './worker-agent-factory.js';

export {
  BaseShadowAgent,
  ShadowAgentFactory,
  ShadowAgentConfigSchema,
  createShadowAgent
} from './shadow-agent-factory.js';

// ============================================================================
// Types
// ============================================================================

export {
  type AgentRole,
  type WorkerAgentConfig,
  type ShadowAgentConfig,
  type WorkerBehaviors,
  type PathConfig,
  type NetworkConfig
} from './types/agent-config.js';

export {
  type TaskAssignedEvent,
  type TaskCompletedEvent,
  type TaskFailedEvent,
  type BackupEvent,
  TaskAssignedEventSchema,
  TaskCompletedEventSchema,
  TaskFailedEventSchema,
  BackupEventSchema,
  isTaskAssignedEvent,
  isTaskCompletedEvent,
  isTaskFailedEvent,
  isBackupEvent,
  parseTaskAssignedEvent,
  parseTaskCompletedEvent,
  parseTaskFailedEvent,
  parseBackupEvent
} from './types/event-schemas.js';

export {
  ErrorType,
  type ToolSchema,
  type ToolInvocationSuccess,
  type ToolInvocationFailure,
  type ToolInvocationResult,
  type ToolInvocationParams,
  type ErrorClassification,
  ToolInvocationSuccessSchema,
  ToolInvocationFailureSchema,
  ToolInvocationResultSchema,
  ToolInvocationParamsSchema,
  isToolInvocationSuccess,
  isToolInvocationFailure,
  classifyToolError
} from './types/tool-schemas.js';
