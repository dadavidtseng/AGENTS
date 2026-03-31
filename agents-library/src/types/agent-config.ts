/**
 * Agent Configuration Type Definitions
 * =====================================
 *
 * Configuration interfaces for worker agents, shadow agents, and custom behaviors.
 * These types enable configuration-driven agent instantiation with strong type safety.
 *
 * Design Pattern: Strategy Pattern
 * - WorkerBehaviors allows customization of agent behavior without code duplication
 * - Each agent role can override specific behaviors while sharing common infrastructure
 *
 * @module agent-config
 */

// ============================================================================
// Worker Agent Configuration
// ============================================================================

/**
 * Role types for worker agents
 *
 * Defines the type of work the agent performs in the multi-agent orchestration system.
 * Each role has specific responsibilities:
 * - artist: Creates visual content and artwork
 * - designer: Creates UI/UX designs and mockups
 * - programmer: Writes code and implements features
 */
export type AgentRole = 'artist' | 'designer' | 'programmer' | 'builder' | 'deployer';

/**
 * Custom behavior overrides for worker agents
 *
 * Allows role-specific customization of agent behavior using the Strategy Pattern.
 * All behaviors are optional - if not provided, default implementations are used.
 *
 * @example
 * ```typescript
 * const customBehaviors: WorkerBehaviors = {
 *   determineFilename: (taskId, taskDescription) => {
 *     // Custom filename logic for artist role
 *     return `artwork-${taskId}.png`;
 *   },
 *   formatCommitMessage: (taskId, files) => {
 *     return `feat: create artwork for task ${taskId} (${files.length} files)`;
 *   }
 * };
 * ```
 */
export interface WorkerBehaviors {
  /**
   * Determine filename for created content
   *
   * Override this to customize how filenames are generated for the agent's output.
   * Default behavior uses task ID and role-specific extensions.
   *
   * @param taskId - Unique task identifier
   * @param taskDescription - Human-readable task description
   * @returns Filename for the created content (e.g., 'artwork-123.png', 'design-456.figma')
   */
  determineFilename?: (taskId: string, taskDescription: string) => string;

  /**
   * Format git commit message
   *
   * Override this to customize commit message format for the agent's commits.
   * Default format: "feat: create {type} for task {taskId}"
   *
   * @param taskId - Unique task identifier
   * @param files - Array of file paths that were modified/created
   * @returns Formatted commit message
   */
  formatCommitMessage?: (taskId: string, files: string[]) => string;

  /**
   * Preprocess task before execution
   *
   * Override this to add role-specific task preprocessing (e.g., parse special formats,
   * validate requirements, extract metadata).
   *
   * @param taskDescription - Raw task description from orchestrator
   * @returns Preprocessed task description or metadata object
   */
  preprocessTask?: (taskDescription: string) => string | Record<string, any>;
}

/**
 * Configuration for worker agents (artist, designer, programmer)
 *
 * Worker agents receive task assignments, execute them using Claude API,
 * create files in git worktrees, and publish completion events.
 *
 * @example
 * ```typescript
 * const config: WorkerAgentConfig = {
 *   role: 'artist',
 *   worktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi'],
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
 *   claudeModel: 'claude-sonnet-4-20250514',
 *   customBehaviors: {
 *     determineFilename: (taskId) => `artwork-${taskId}.png`
 *   }
 * };
 * ```
 */
export interface WorkerAgentConfig {
  /**
   * Optional custom agent ID for broker registration.
   * Defaults to `agent-${role}` if not provided.
   *
   * @example 'agent-worker-artist'
   */
  agentId?: string;

  /**
   * Agent role type
   *
   * Determines the type of work this agent performs and affects:
   * - Event topic patterns (e.g., 'artist.task.assigned')
   * - Default file extensions
   * - Commit message prefixes
   */
  role: AgentRole;

  /**
   * Absolute path to git worktree for this agent
   *
   * Agent will create files and commits in this directory.
   * Must be a valid git worktree with initialized repository.
   *
   * @example 'C:/p4/Personal/SD/agent-playground-artist'
   */
  worktreePath: string;

  /**
   * KĀDI broker WebSocket URL
   *
   * Agent connects to this broker to subscribe to task events and publish completion events.
   *
   * @example 'ws://localhost:8080/kadi'
   * @example 'wss://broker.example.com/kadi'
   */
  brokerUrl: string;

  /**
   * Network(s) this agent belongs to
   *
   * Used for network-based event routing in KĀDI broker.
   * Agent will only receive events published to these networks.
   *
   * @example ['kadi'] - Default network
   * @example ['production', 'team-alpha'] - Multiple networks
   */
  networks: string[];

  /**
   * Anthropic API key for Claude integration
   *
   * Required for task execution using Claude API.
   * Should be loaded from environment variable (ANTHROPIC_API_KEY).
   */
  anthropicApiKey: string;

  /**
   * Claude model to use for task execution
   *
   * @default 'claude-sonnet-4-20250514'
   * @example 'claude-sonnet-4-20250514' - Latest Sonnet 4
   * @example 'claude-opus-4-20250514' - Opus 4 for complex tasks
   */
  claudeModel?: string;

  /**
   * Agent capabilities for task validation
   *
   * List of capability keywords that describe what this agent can do.
   * Used to validate incoming tasks before execution — if a task description
   * doesn't match any capabilities, the agent rejects the task.
   *
   * @example ['file-creation', 'image-generation', 'creative-content']
   * @example ['ui-design', 'css', 'responsive-layout']
   */
  capabilities?: string[];

  /**
   * Custom behavior overrides for role-specific functionality
   *
   * Optional strategy pattern implementation for customizing agent behavior
   * without modifying shared code.
   */
  customBehaviors?: WorkerBehaviors;
}

// ============================================================================
// Worker Agent Full Configuration (extends BaseAgentConfig)
// ============================================================================

/**
 * Full configuration for BaseWorkerAgent when it extends BaseAgent.
 *
 * Combines BaseAgentConfig (broker, provider, memory) with worker-specific
 * fields (role, worktree, model, capabilities). This eliminates the need
 * for separate BaseAgent + WorkerAgent creation and manual service injection.
 *
 * @example
 * ```typescript
 * const config: WorkerAgentFullConfig = {
 *   // BaseAgentConfig fields
 *   agentId: 'agent-worker-artist',
 *   agentRole: 'artist',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['artist', 'global'],
 *   provider: { anthropicApiKey: '...' },
 *   memory: { dataPath: './data/memory' },
 *   // Worker-specific fields
 *   role: 'artist',
 *   worktreePath: '/path/to/worktree',
 *   claudeModel: 'gpt-5-mini',
 *   capabilities: ['art', 'illustration'],
 * };
 * ```
 */
export interface WorkerAgentFullConfig {
  // === BaseAgentConfig fields ===
  agentId: string;
  agentRole: string;
  version?: string;
  brokerUrl: string;
  networks: string[];
  additionalBrokers?: Record<string, { url: string; networks: string[] }>;
  provider?: {
    anthropicApiKey?: string;
    modelManagerBaseUrl?: string;
    modelManagerApiKey?: string;
    primaryProvider?: string;
    fallbackProvider?: string;
    retryAttempts?: number;
    retryDelayMs?: number;
    healthCheckIntervalMs?: number;
  };
  memory?: {
    dataPath: string;
  };

  // === Worker-specific fields ===
  role: AgentRole;
  worktreePath: string;
  claudeModel?: string;
  capabilities?: string[];
  customBehaviors?: WorkerBehaviors;
}

// ============================================================================
// Shadow Agent Configuration
// ============================================================================

/**
 * Configuration for shadow agents (backup/monitoring agents)
 *
 * Shadow agents watch worker agent worktrees for changes and create mirror commits
 * in shadow worktrees for backup and recovery purposes.
 *
 * @example
 * ```typescript
 * const config: ShadowAgentConfig = {
 *   role: 'artist',
 *   workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   shadowWorktreePath: 'C:/p4/Personal/SD/shadow-artist-backup',
 *   workerBranch: 'main',
 *   shadowBranch: 'shadow-main',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi'],
 *   debounceMs: 2000
 * };
 * ```
 */
export interface ShadowAgentConfig {
  /**
   * Agent role type (matches corresponding worker agent)
   *
   * Used for event payload agent identification (e.g., 'shadow-agent-artist').
   */
  role: string;

  /**
   * Absolute path to worker agent's git worktree
   *
   * Shadow agent watches this directory for file changes.
   *
   * @example 'C:/p4/Personal/SD/agent-playground-artist'
   */
  workerWorktreePath: string;

  /**
   * Absolute path to shadow agent's git worktree
   *
   * Shadow agent creates mirror commits in this directory.
   * Must be a separate git repository from worker worktree.
   *
   * @example 'C:/p4/Personal/SD/shadow-artist-backup'
   */
  shadowWorktreePath: string;

  /**
   * Git branch name in worker worktree to monitor
   *
   * Shadow agent watches for commits on this branch.
   *
   * @example 'main'
   * @example 'develop'
   */
  workerBranch: string;

  /**
   * Git branch name in shadow worktree for mirror commits
   *
   * Shadow agent creates commits on this branch.
   *
   * @example 'shadow-main'
   * @example 'backup-main'
   */
  shadowBranch: string;

  /**
   * KĀDI broker WebSocket URL
   *
   * Shadow agent publishes backup events to this broker.
   *
   * @example 'ws://localhost:8080/kadi'
   */
  brokerUrl: string;

  /**
   * Network(s) this shadow agent belongs to
   *
   * Used for event routing in KĀDI broker.
   *
   * @example ['kadi']
   */
  networks: string[];

  /**
   * Debounce delay in milliseconds for file change events
   *
   * Prevents creating multiple commits for rapid file changes.
   * Shadow agent waits this duration after last change before creating commit.
   *
   * @default 1000
   * @example 2000 - Wait 2 seconds after last change
   */
  debounceMs?: number;
}

// ============================================================================
// Path Configuration (Shared)
// ============================================================================

/**
 * Path configuration for agent worktrees
 *
 * Helper interface for organizing agent-related paths.
 * Used internally by factories.
 */
export interface PathConfig {
  /**
   * Base directory for all agent worktrees
   *
   * @example 'C:/p4/Personal/SD'
   */
  baseDir: string;

  /**
   * Role-specific worktree path
   *
   * @example 'agent-playground-artist'
   */
  worktreeName: string;
}

// ============================================================================
// Network Configuration (Shared)
// ============================================================================

/**
 * Network configuration for KĀDI broker connection
 *
 * Helper interface for broker connection settings.
 * Used internally by factories.
 */
export interface NetworkConfig {
  /**
   * KĀDI broker WebSocket URL
   */
  brokerUrl: string;

  /**
   * Networks this agent belongs to
   */
  networks: string[];

  /**
   * Connection timeout in milliseconds
   *
   * @default 30000 (30 seconds)
   */
  connectionTimeout?: number;

  /**
   * Maximum retry attempts for failed connections
   *
   * @default 5
   */
  maxRetries?: number;
}
