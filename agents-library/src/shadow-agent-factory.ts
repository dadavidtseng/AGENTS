/**
 * Shadow Agent Factory
 * =====================
 *
 * Factory for creating shadow agents (backup/monitoring agents) with
 * configuration-driven instantiation and shared infrastructure.
 *
 * Architecture Pattern: **Composition over Inheritance**
 * - BaseShadowAgent COMPOSES with BaseBot (does NOT extend)
 * - Uses delegation pattern to access BaseBot's circuit breaker and retry logic
 * - This avoids tight coupling and allows flexible behavior customization
 *
 * Design Principles:
 * - Factory pattern for consistent agent creation
 * - Composition over inheritance for flexibility
 * - Template method pattern for lifecycle management (start/stop)
 * - Observer pattern for filesystem and git ref watching
 *
 * Shadow Agent Responsibilities:
 * - Monitor worker agent worktrees for file changes
 * - Create granular backup commits in shadow worktrees
 * - Mirror worker commits to shadow branch
 * - Publish backup events to KĀDI broker
 *
 * @module shadow-agent-factory
 */

import { KadiClient, z } from '@kadi.build/core';
import type { ShadowAgentConfig } from './types/agent-config.js';
import { BaseAgent } from './base-agent.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { logger, MODULE_AGENT } from './utils/logger.js';
import { timer } from './utils/timer.js';

// ============================================================================
// BaseShadowAgent Class
// ============================================================================

/**
 * Base class for shadow agents (backup/monitoring agents)
 *
 * **CIRCUIT BREAKER PATTERN**: This class implements its own circuit breaker for git operations.
 * - Tracks consecutive failures and opens circuit after threshold
 * - Prevents cascading failures from overwhelming the system
 * - Auto-resets circuit after timeout period
 * - Provides resilient git operations with retry logic
 *
 * Why Not Use BaseBot?
 * - BaseBot is designed for chat bots and requires Anthropic API key
 * - Shadow agents don't need Claude integration, just git operations
 * - Simpler, focused circuit breaker implementation for git-specific needs
 *
 * Shadow Agent Architecture:
 * 1. **Filesystem Watcher**: Monitors worker worktree for file operations (create/modify/delete)
 * 2. **Git Ref Watcher**: Monitors worker commits to mirror them in shadow worktree
 * 3. **Atomic Git Operations**: add + commit for each monitored event
 * 4. **Circuit Breaker**: Error handling with retry and fallback via BaseBot
 * 5. **Event Publishing**: Publishes backup completion/failure events
 *
 * Lifecycle:
 * 1. Constructor: Initialize configuration and compose utilities
 * 2. start(): Connect to broker, initialize watchers, subscribe to events
 * 3. [Monitoring happens asynchronously via filesystem/git watchers]
 * 4. stop(): Cleanup watchers, unsubscribe, disconnect from broker
 *
 * @example
 * ```typescript
 * const config: ShadowAgentConfig = {
 *   role: 'artist',
 *   workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   shadowWorktreePath: 'C:/p4/Personal/SD/shadow-agent-playground-artist',
 *   workerBranch: 'agent-artist',
 *   shadowBranch: 'shadow-agent-artist',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi'],
 *   debounceMs: 1000
 * };
 *
 * const agent = new BaseShadowAgent(config);
 * await agent.start();
 * // Agent now monitors worker worktree and creates shadow backups
 * ```
 */
export class BaseShadowAgent {
  /**
   * KĀDI client for broker communication
   *
   * Used for:
   * - Subscribing to events
   * - Publishing backup completion/failure events
   * - Accessing broker protocol for tool invocation
   */
  protected client: KadiClient;

  /**
   * Agent role (matches corresponding worker agent)
   *
   * Used for:
   * - Event payload agent identification (shadow-agent-{role})
   * - Logging and identification
   */
  protected role: string;

  /**
   * Absolute path to worker agent's git worktree
   *
   * Shadow agent watches this directory for file changes.
   * This is the source of truth for file operations.
   *
   * @example 'C:/p4/Personal/SD/agent-playground-artist'
   */
  protected workerWorktreePath: string;

  /**
   * Absolute path to shadow agent's git worktree
   *
   * Shadow agent creates mirror commits in this directory.
   * Must be a separate git repository from worker worktree.
   *
   * @example 'C:/p4/Personal/SD/shadow-agent-playground-artist'
   */
  protected shadowWorktreePath: string;

  /**
   * Git branch name in worker worktree to monitor
   *
   * Shadow agent watches for commits on this branch.
   *
   * @example 'agent-artist'
   */
  protected workerBranch: string;

  /**
   * Git branch name in shadow worktree for mirror commits
   *
   * Shadow agent creates commits on this branch.
   *
   * @example 'shadow-agent-artist'
   */
  protected shadowBranch: string;

  /**
   * Debounce delay in milliseconds for file change events
   *
   * Prevents creating multiple commits for rapid file changes.
   * Shadow agent waits this duration after last change before creating commit.
   *
   * @default 1000
   */
  protected debounceMs: number;

  /**
   * Circuit breaker state for git operations
   *
   * Tracks consecutive failures and blocks operations when threshold exceeded.
   * Prevents cascading failures and allows system to recover.
   */
  private gitCircuitOpen: boolean = false;

  /**
   * Consecutive git operation failure count
   *
   * Incremented on each failure, reset to 0 on success.
   * Circuit opens when count reaches MAX_GIT_FAILURES threshold.
   */
  private gitFailureCount: number = 0;

  /**
   * Maximum git failures before circuit opens
   *
   * @default 5
   */
  private readonly MAX_GIT_FAILURES: number = 5;

  /**
   * Circuit breaker reset timeout in milliseconds
   *
   * After this duration, circuit automatically closes and retries are allowed.
   *
   * @default 60000 (1 minute)
   */
  private readonly CIRCUIT_RESET_TIME: number = 60000;

  /**
   * Full agent configuration
   *
   * Stored for reference and potential reconfiguration.
   * Currently unused but reserved for future features (e.g., hot-reloading config).
   */
  // @ts-expect-error - Reserved for future use (hot-reloading config)
  private readonly config: ShadowAgentConfig;

  /**
   * Whether this agent delegates connection management to a BaseAgent instance.
   * When true, start() skips broker connection and stop() skips disconnection.
   */
  private readonly usesBaseAgent: boolean;

  /**
   * Handler reference for broker file.changed events.
   * Stored so we can unsubscribe on stop().
   */
  private fileEventHandler: ((event: unknown) => void) | null = null;

  /**
   * Native ability-file-local instance for in-process file operations.
   * Set via setNativeFileLocal() after loadNative in the consuming agent.
   */
  private nativeFileLocal: any | null = null;

  /**
   * Set of changed file paths awaiting backup processing
   *
   * Stores relative file paths from worker worktree for batch processing.
   * Debounced to avoid rapid-fire commits for the same file.
   *
   * Key: Absolute file path
   * Value: Debounce timeout handle
   */
  private debounceMap: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Create a new BaseShadowAgent instance
   *
   * Initializes all configuration properties and composes utility classes
   * (BaseBot, KadiEventPublisher). Does NOT connect to broker or start watchers yet -
   * call start() to begin monitoring.
   *
   * @param config - Shadow agent configuration with all required fields
   *
   * @example
   * ```typescript
   * const agent = new BaseShadowAgent({
   *   role: 'artist',
   *   workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
   *   shadowWorktreePath: 'C:/p4/Personal/SD/shadow-agent-playground-artist',
   *   workerBranch: 'agent-artist',
   *   shadowBranch: 'shadow-agent-artist',
   *   brokerUrl: 'ws://localhost:8080/kadi',
   *   networks: ['kadi'],
   *   debounceMs: 1000
   * });
   * ```
   */
  constructor(config: ShadowAgentConfig, baseAgent?: BaseAgent) {
    // Start timer for performance tracking
    timer.start('shadow-factory');

    // Store configuration
    this.config = config;
    this.role = config.role;
    this.workerWorktreePath = config.workerWorktreePath;
    this.shadowWorktreePath = config.shadowWorktreePath;
    this.workerBranch = config.workerBranch;
    this.shadowBranch = config.shadowBranch;
    this.debounceMs = config.debounceMs || 1000;

    // Initialize KĀDI client — delegate to BaseAgent if provided, else create own
    if (baseAgent) {
      this.client = baseAgent.client;
      this.usesBaseAgent = true;
      logger.info(MODULE_AGENT, '   Using BaseAgent client (connection managed externally)', timer.elapsed('shadow-factory'));
    } else {
      this.client = new KadiClient({
        name: `shadow-agent-${config.role}`,
        version: '1.0.0',
        brokers: {
          default: { url: config.brokerUrl, networks: config.networks }
        },
        defaultBroker: 'default',
      });
      this.usesBaseAgent = false;
    }

    logger.info(MODULE_AGENT, `BaseShadowAgent initialized for role: ${this.role}`, timer.elapsed('shadow-factory'));
    logger.info(MODULE_AGENT, `   Worker worktree: ${this.workerWorktreePath}`, timer.elapsed('shadow-factory'));
    logger.info(MODULE_AGENT, `   Shadow worktree: ${this.shadowWorktreePath}`, timer.elapsed('shadow-factory'));
    logger.info(MODULE_AGENT, `   Worker branch: ${this.workerBranch}`, timer.elapsed('shadow-factory'));
    logger.info(MODULE_AGENT, `   Shadow branch: ${this.shadowBranch}`, timer.elapsed('shadow-factory'));
    logger.info(MODULE_AGENT, `   Debounce delay: ${this.debounceMs}ms`, timer.elapsed('shadow-factory'));
  }

  /**
   * Set native ability-file-local for in-process file operations.
   * Call this after loadNative('ability-file-local') in the consuming agent.
   */
  setNativeFileLocal(native: any): void {
    this.nativeFileLocal = native;
  }

  /**
   * Start the shadow agent
   *
   * Performs initialization sequence:
   * 1. Connect to KĀDI broker
   * 2. Initialize broker protocol
   * 3. Connect event publisher
   * 4. Setup filesystem watcher for worker worktree
   * 5. Setup git ref watcher for worker branch
   * 6. Enter monitoring loop (non-blocking)
   *
   * After start() completes, the agent is ready to monitor file changes and create backups.
   *
   * @throws {Error} If broker connection fails after all retries
   *
   * @example
   * ```typescript
   * const agent = new BaseShadowAgent(config);
   * await agent.start();
   * console.log('Shadow agent is now monitoring worker worktree');
   * ```
   */
  async start(): Promise<void> {
    logger.info(MODULE_AGENT, `Starting shadow agent for role: ${this.role}`, timer.elapsed('shadow-factory'));

    // Connect to KĀDI broker (skip if BaseAgent manages connection)
    if (this.usesBaseAgent) {
      logger.info(MODULE_AGENT, '   Broker connection managed by BaseAgent (skipping)', timer.elapsed('shadow-factory'));
    } else {
      logger.info(MODULE_AGENT, '   → Connecting to KĀDI broker...', timer.elapsed('shadow-factory'));
      try {
        await this.client.connect();
        logger.info(MODULE_AGENT, '   Connected to KĀDI broker', timer.elapsed('shadow-factory'));
      } catch (error: any) {
        logger.error(MODULE_AGENT, 'Broker connection error', timer.elapsed('shadow-factory'), error);
        process.exit(1);
      }
    }

    // Subscribe to file.changed broker events (emitted by ability-file-local)
    await this.setupBrokerFileEventSubscription();
    logger.info(MODULE_AGENT, 'Broker file event subscription active', timer.elapsed('shadow-factory'));

    logger.info(MODULE_AGENT, 'Shadow agent started and monitoring via broker events', timer.elapsed('shadow-factory'));
  }

  /**
   * Stop the shadow agent
   *
   * Performs cleanup sequence:
   * 1. Stop filesystem watcher
   * 2. Stop git ref watcher
   * 3. Clear debounce timers
   * 4. Disconnect event publisher
   * 5. Disconnect KĀDI client
   * 6. Clear protocol reference
   *
   * After stop() completes, the agent is fully shut down and can be safely destroyed.
   *
   * @example
   * ```typescript
   * await agent.stop();
   * console.log('Shadow agent has been stopped');
   * ```
   */
  async stop(): Promise<void> {
    logger.info(MODULE_AGENT, `Stopping shadow agent for role: ${this.role}`, timer.elapsed('shadow-factory'));

    // Unsubscribe from broker file events
    if (this.fileEventHandler) {
      logger.info(MODULE_AGENT, 'Unsubscribing from file.changed events...', timer.elapsed('shadow-factory'));
      try {
        await (this.client as any).unsubscribe('file.changed', this.fileEventHandler);
      } catch {
        // Best-effort unsubscribe — may not be supported in all KadiClient versions
      }
      this.fileEventHandler = null;
      logger.info(MODULE_AGENT, 'File event subscription removed', timer.elapsed('shadow-factory'));
    }

    // Clear all pending debounce timers
    if (this.debounceMap.size > 0) {
      logger.info(MODULE_AGENT, `Clearing ${this.debounceMap.size} pending debounce timers...`, timer.elapsed('shadow-factory'));
      for (const timeout of this.debounceMap.values()) {
        clearTimeout(timeout);
      }
      this.debounceMap.clear();
      logger.info(MODULE_AGENT, 'Debounce timers cleared', timer.elapsed('shadow-factory'));
    }

    // Disconnect KĀDI client (skip if BaseAgent manages connection)
    if (this.usesBaseAgent) {
      logger.info(MODULE_AGENT, '   Broker disconnection managed by BaseAgent (skipping)', timer.elapsed('shadow-factory'));
    } else {
      logger.info(MODULE_AGENT, '   → Disconnecting from KĀDI broker...', timer.elapsed('shadow-factory'));
      await this.client.disconnect();
      logger.info(MODULE_AGENT, '   Disconnected from KĀDI broker', timer.elapsed('shadow-factory'));
    }

    logger.info(MODULE_AGENT, 'Shadow agent stopped', timer.elapsed('shadow-factory'));
  }

  /**
   * Subscribe to file.changed broker events from ability-file-local
   *
   * Instead of using chokidar directly (unreliable on /mnt/c/ in WSL containers),
   * the shadow agent subscribes to `file.changed` events published by ability-file-local
   * which runs on the host where filesystem events work natively.
   *
   * Event payload from ability-file-local:
   *   { watchId: string, event: 'add'|'change'|'unlink', path: string }
   *
   * The shadow agent filters events to only process those matching its workerWorktreePath,
   * then debounces and creates shadow backup commits.
   */
  protected async setupBrokerFileEventSubscription(): Promise<void> {
    logger.info(MODULE_AGENT, `Subscribing to file.changed broker events for: ${this.workerWorktreePath}`, timer.elapsed('shadow-factory'));

    const handler = async (event: unknown) => {
      try {
        const data = ((event as any)?.data || event) as {
          watchId?: string;
          event?: string;
          path?: string;
        };

        if (!data.path || !data.event) return;

        const filePath = data.path;

        // Filter: only process events for our worker worktree
        // Normalize both paths for comparison (handle Windows/Unix path differences)
        const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase();
        const normalizedWorktree = this.workerWorktreePath.replace(/\\/g, '/').toLowerCase();
        if (!normalizedFile.startsWith(normalizedWorktree)) return;

        // Skip .git, node_modules, .env files
        const relativePath = path.relative(this.workerWorktreePath, filePath);
        if (
          relativePath.startsWith('.git') ||
          relativePath.includes('node_modules') ||
          relativePath.startsWith('.env')
        ) return;

        const eventType = data.event; // 'add' | 'change' | 'unlink'
        const operation = eventType === 'add' ? 'Created'
          : eventType === 'unlink' ? 'Deleted'
          : 'Modified';

        logger.info(MODULE_AGENT, `📁 Broker file event: ${operation} ${relativePath}`, timer.elapsed('shadow-factory'));

        // Debounce to avoid rapid-fire commits
        if (this.debounceMap.has(filePath)) {
          clearTimeout(this.debounceMap.get(filePath)!);
        }

        const timeout = setTimeout(async () => {
          logger.info(MODULE_AGENT, `Processing ${operation.toLowerCase()} file: ${relativePath}`, timer.elapsed('shadow-factory'));
          await this.createShadowBackup(operation, relativePath);
          this.debounceMap.delete(filePath);
        }, this.debounceMs);

        this.debounceMap.set(filePath, timeout);
      } catch (err: any) {
        logger.error(MODULE_AGENT, `Error processing file.changed event: ${err.message}`, timer.elapsed('shadow-factory'), err);
      }
    };

    this.fileEventHandler = handler;
    await this.client.subscribe('file.changed', handler);
    logger.info(MODULE_AGENT, 'Subscribed to file.changed broker events', timer.elapsed('shadow-factory'));

    // Invoke ability-file-local's watch_folder to start emitting file.changed events
    if (this.nativeFileLocal) {
      try {
        await this.nativeFileLocal.invoke('watch_folder', {
          folderPath: this.workerWorktreePath,
          watchId: `shadow-${this.role}`,
        });
        logger.info(MODULE_AGENT, `Started file watcher via native ability-file-local for: ${this.workerWorktreePath}`, timer.elapsed('shadow-factory'));
      } catch (err: any) {
        logger.warn(MODULE_AGENT, `Could not start native file watcher: ${err.message}`, timer.elapsed('shadow-factory'));
      }
    } else {
      logger.warn(MODULE_AGENT, 'ability-file-local not loaded natively — file watcher disabled (broker fallback not available)', timer.elapsed('shadow-factory'));
    }
  }

  /**
   * Create shadow backup commit
   *
   * Creates a mirror commit in shadow worktree by:
   * 1. Parsing latest commit from worker worktree (git log)
   * 2. Getting list of changed files (git diff)
   * 3. Copying changed files from worker to shadow worktree
   * 4. Creating mirror commit with format: Shadow: {operation} {fileName}
   *
   * Uses circuit breaker pattern to prevent cascading failures on git errors.
   * Publishes backup completion/failure events to KĀDI broker.
   *
   * @param operation - Type of operation (e.g., 'Created', 'Modified', 'Deleted', 'COMMIT')
   * @param fileName - File name or commit description
   *
   * @example
   * ```typescript
   * await this.createShadowBackup('Created', 'artwork.png');
   * await this.createShadowBackup('COMMIT', 'Commit abc1234');
   * ```
   */
  protected async createShadowBackup(operation: string, fileName: string): Promise<void> {
    logger.info(MODULE_AGENT, `📦 Creating shadow backup: ${operation} - ${fileName}`, timer.elapsed('shadow-factory'));

    // Check circuit breaker state before attempting git operations
    if (this.checkCircuitBreaker()) {
      logger.warn(MODULE_AGENT, `Circuit breaker open - skipping backup operation`, timer.elapsed('shadow-factory'));
      return;
    }

    try {
      // For COMMIT operations, parse worker commit and copy changed files
      if (operation === 'COMMIT') {
        logger.info(MODULE_AGENT, `Processing worker commit mirror...`, timer.elapsed('shadow-factory'));

        // Step 1: Get latest commit hash from worker worktree
        const commitHash = execSync('git log -1 --format=%H', {
          cwd: this.workerWorktreePath,
          encoding: 'utf-8'
        }).trim();

        logger.info(MODULE_AGENT, `   Worker commit SHA: ${commitHash.substring(0, 7)}`, timer.elapsed('shadow-factory'));

        // Step 2: Get commit message from worker
        const commitMessage = execSync('git log -1 --format=%B', {
          cwd: this.workerWorktreePath,
          encoding: 'utf-8'
        }).trim();

        logger.info(MODULE_AGENT, `   Worker commit message: ${commitMessage}`, timer.elapsed('shadow-factory'));

        // Step 3: Get list of changed files using git diff
        let changedFiles: string[] = [];
        try {
          const diffOutput = execSync('git diff --name-only HEAD~1 HEAD', {
            cwd: this.workerWorktreePath,
            encoding: 'utf-8'
          }).trim();

          changedFiles = diffOutput ? diffOutput.split('\n').filter(f => f.trim()) : [];
          logger.info(MODULE_AGENT, `   Changed files: ${changedFiles.length} file(s)`, timer.elapsed('shadow-factory'));
        } catch (diffError: any) {
          // Handle case where there's no parent commit (initial commit)
          if (diffError.message.includes('unknown revision')) {
            logger.info(MODULE_AGENT, `   Initial commit detected - getting all files`, timer.elapsed('shadow-factory'));
            const allFilesOutput = execSync('git ls-tree -r HEAD --name-only', {
              cwd: this.workerWorktreePath,
              encoding: 'utf-8'
            }).trim();
            changedFiles = allFilesOutput ? allFilesOutput.split('\n').filter(f => f.trim()) : [];
          } else {
            throw diffError;
          }
        }

        // Step 4: Copy changed files from worker to shadow worktree
        for (const file of changedFiles) {
          const srcPath = path.join(this.workerWorktreePath, file);
          const destPath = path.join(this.shadowWorktreePath, file);

          // Create destination directory if needed
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }

          // Copy file
          try {
            fs.copyFileSync(srcPath, destPath);
            logger.info(MODULE_AGENT, `   ✓ Copied: ${file}`, timer.elapsed('shadow-factory'));
          } catch (copyError: any) {
            // File may have been deleted - that's ok, git will handle it
            logger.info(MODULE_AGENT, `   Could not copy ${file}: ${copyError.message}`, timer.elapsed('shadow-factory'));
          }
        }

        // Step 5: Stage all changes in shadow worktree
        execSync('git add -A', {
          cwd: this.shadowWorktreePath,
          encoding: 'utf-8'
        });

        // Step 5.5: Check if there are staged changes (FS watcher may have already committed)
        try {
          execSync('git diff --cached --quiet', { cwd: this.shadowWorktreePath });
          // Exit code 0 = nothing staged — FS watcher already backed up this change
          logger.info(MODULE_AGENT, `No new changes to commit (already backed up by filesystem watcher)`, timer.elapsed('shadow-factory'));
          this.recordGitSuccess();
          await this.publishBackupStatus(true, changedFiles, 'mirror-commit-skipped');
          return;
        } catch {
          // Exit code 1 = staged changes exist — proceed with commit
        }

        // Step 6: Create mirror commit in shadow worktree
        const shadowCommitMessage = `Shadow: ${operation} ${fileName}\n\nMirror of: ${commitMessage}\nOriginal SHA: ${commitHash}`;

        execSync(`git commit -m "${shadowCommitMessage.replace(/"/g, '\\"')}"`, {
          cwd: this.shadowWorktreePath,
          encoding: 'utf-8'
        });

        // Get shadow commit SHA
        const shadowCommitHash = execSync('git log -1 --format=%H', {
          cwd: this.shadowWorktreePath,
          encoding: 'utf-8'
        }).trim();

        logger.info(MODULE_AGENT, `Shadow commit created: ${shadowCommitHash.substring(0, 7)}`, timer.elapsed('shadow-factory'));

        // Record success and reset failure count
        this.recordGitSuccess();

        // Publish backup success event using standardized method
        await this.publishBackupStatus(true, changedFiles, 'mirror-commit');

      } else {
        // For file operations (Created, Modified, Deleted), handle individual file
        logger.info(MODULE_AGENT, `Processing file operation: ${operation} - ${fileName}`, timer.elapsed('shadow-factory'));

        const srcPath = path.join(this.workerWorktreePath, fileName);
        const destPath = path.join(this.shadowWorktreePath, fileName);

        // Create destination directory if needed
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        // Copy file if it exists (for Created/Modified operations)
        if (operation !== 'Deleted' && fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          logger.info(MODULE_AGENT, `   ✓ Copied: ${fileName}`, timer.elapsed('shadow-factory'));
        }

        // Stage changes in shadow worktree
        if (operation === 'Deleted') {
          // For deletions, remove the file and stage the deletion
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
          execSync(`git add "${fileName}"`, {
            cwd: this.shadowWorktreePath,
            encoding: 'utf-8'
          });
        } else {
          // For additions/modifications, stage the file
          execSync(`git add "${fileName}"`, {
            cwd: this.shadowWorktreePath,
            encoding: 'utf-8'
          });
        }

        // Check if there are actually staged changes (FS watcher may fire duplicate events)
        try {
          execSync('git diff --cached --quiet', { cwd: this.shadowWorktreePath });
          // Exit code 0 = nothing staged — content is identical to HEAD
          logger.info(MODULE_AGENT, `No new changes to commit (file unchanged)`, timer.elapsed('shadow-factory'));
          this.recordGitSuccess();
          await this.publishBackupStatus(true, [fileName], `file-${operation.toLowerCase()}-skipped`);
          return;
        } catch {
          // Exit code 1 = staged changes exist — proceed with commit
        }

        // Create backup commit
        const commitMessage = `Shadow: ${operation} ${fileName}`;
        execSync(`git commit -m "${commitMessage}"`, {
          cwd: this.shadowWorktreePath,
          encoding: 'utf-8'
        });

        // Get commit SHA
        const commitHash = execSync('git log -1 --format=%H', {
          cwd: this.shadowWorktreePath,
          encoding: 'utf-8'
        }).trim();

        logger.info(MODULE_AGENT, `Shadow backup commit created: ${commitHash.substring(0, 7)}`, timer.elapsed('shadow-factory'));

        // Record success and reset failure count
        this.recordGitSuccess();

        // Publish backup success event using standardized method
        await this.publishBackupStatus(true, [fileName], `file-${operation.toLowerCase()}`);
      }

    } catch (error: any) {
      logger.error(MODULE_AGENT, `Shadow backup failed: ${error.message}`, timer.elapsed('shadow-factory'), error);

      // Record failure and potentially open circuit breaker
      this.recordGitFailure('createShadowBackup', error);

      // Only publish failure event if circuit is not open (avoid spam)
      if (!this.checkCircuitBreaker()) {
        await this.publishBackupStatus(
          false,
          [],
          operation === 'COMMIT' ? 'mirror-commit' : `file-${operation.toLowerCase()}`,
          error
        );
      }
    }
  }

  /**
   * Publish backup status event to KĀDI broker
   *
   * Publishes standardized BackupEvent with schema compliance for both success
   * and failure scenarios. Events follow generic topic pattern: backup.{completed|failed} with agent identity in payload.
   *
   * Uses KadiEventPublisher for resilient event publishing with connection retry logic.
   * Handles publishing failures gracefully without throwing errors.
   *
   * @param success - True for backup success, false for failure
   * @param filesBackedUp - Array of file paths that were backed up
   * @param operation - Backup operation type (e.g., 'mirror-commit', 'file-create')
   * @param error - Error object if backup failed (optional)
   *
   * @example
   * ```typescript
   * // Success case
   * await this.publishBackupStatus(true, ['artwork.png', 'logo.svg'], 'mirror-commit');
   *
   * // Failure case
   * await this.publishBackupStatus(false, [], 'mirror-commit', new Error('Git operation failed'));
   * ```
   */
  protected async publishBackupStatus(
    success: boolean,
    filesBackedUp: string[],
    operation: string,
    error?: Error
  ): Promise<void> {
    // Generic topic — agent identity is in the payload, not the topic
    const topic = `backup.${success ? 'completed' : 'failed'}`;

    // Create payload matching BackupEvent schema
    const payload: {
      agent: string;
      role: string;
      operation: string;
      status: 'success' | 'failure';
      filesBackedUp: string[];
      error?: string;
      timestamp: string;
    } = {
      agent: `shadow-agent-${this.role}`,
      role: this.role,
      operation,
      status: success ? 'success' : 'failure',
      filesBackedUp,
      timestamp: new Date().toISOString()
    };

    // Add error message if failure
    if (!success && error) {
      payload.error = error.message;
    }

    // Publish event using KadiClient
    await this.client.publish(topic, payload, { broker: 'default', network: 'global' });
    logger.info(MODULE_AGENT, `Published backup ${success ? 'success' : 'failure'} event to ${topic}`, timer.elapsed('shadow-factory'));
  }

  /**
   * Check circuit breaker state for git operations
   *
   * Returns true if circuit is open (blocking requests).
   * Circuit opens after MAX_GIT_FAILURES consecutive failures and auto-resets after CIRCUIT_RESET_TIME.
   *
   * @returns True if circuit is open, false if closed
   *
   * @example
   * ```typescript
   * if (this.checkCircuitBreaker()) {
   *   console.log('Circuit open - skipping backup operation');
   *   return;
   * }
   * ```
   */
  protected checkCircuitBreaker(): boolean {
    return this.gitCircuitOpen;
  }

  /**
   * Record git operation failure and potentially open circuit breaker
   *
   * Increments failure count and opens circuit if threshold exceeded.
   * Auto-resets circuit after timeout period.
   *
   * @param operation - Operation name for logging
   * @param error - Error that occurred
   */
  protected recordGitFailure(operation: string, error: Error): void {
    this.gitFailureCount++;
    logger.error(MODULE_AGENT, `Git operation failed (${this.gitFailureCount}/${this.MAX_GIT_FAILURES}): ${operation}`, timer.elapsed('shadow-factory'), error);

    if (this.gitFailureCount >= this.MAX_GIT_FAILURES) {
      this.gitCircuitOpen = true;
      logger.error(MODULE_AGENT, `🚨 Circuit breaker opened - too many git failures`, timer.elapsed('shadow-factory'));

      // Auto-reset circuit after timeout
      setTimeout(() => {
        this.gitCircuitOpen = false;
        this.gitFailureCount = 0;
        logger.info(MODULE_AGENT, `Circuit breaker reset - retrying git operations`, timer.elapsed('shadow-factory'));
      }, this.CIRCUIT_RESET_TIME);
    }
  }

  /**
   * Record git operation success and reset failure count
   *
   * Resets failure counter on successful operation.
   */
  protected recordGitSuccess(): void {
    this.gitFailureCount = 0;
  }
}

// ============================================================================
// Shadow Agent Configuration Schema
// ============================================================================

/**
 * Zod schema for ShadowAgentConfig validation
 *
 * Validates all required configuration fields for shadow agent instantiation.
 * Ensures type safety and provides descriptive error messages for invalid configurations.
 *
 * Required Fields:
 * - role: Agent role type (non-empty string)
 * - workerWorktreePath: Absolute path to worker agent's git worktree (non-empty string)
 * - shadowWorktreePath: Absolute path to shadow agent's git worktree (non-empty string)
 * - workerBranch: Git branch name in worker worktree (non-empty string)
 * - shadowBranch: Git branch name in shadow worktree (non-empty string)
 * - brokerUrl: KĀDI broker WebSocket URL (non-empty string)
 * - networks: Array of network names (at least one network required)
 *
 * Optional Fields:
 * - debounceMs: Debounce delay in milliseconds (positive number, default: 1000)
 *
 * @example
 * ```typescript
 * const validConfig = {
 *   role: 'artist',
 *   workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   shadowWorktreePath: 'C:/p4/Personal/SD/shadow-artist-backup',
 *   workerBranch: 'main',
 *   shadowBranch: 'shadow-main',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi'],
 *   debounceMs: 2000 // optional
 * };
 *
 * ShadowAgentConfigSchema.parse(validConfig); // Passes validation
 * ```
 */
export const ShadowAgentConfigSchema = z.object({
  role: z.string().min(1, 'Role is required and cannot be empty'),
  workerWorktreePath: z.string().min(1, 'Worker worktree path is required and cannot be empty'),
  shadowWorktreePath: z.string().min(1, 'Shadow worktree path is required and cannot be empty'),
  workerBranch: z.string().min(1, 'Worker branch is required and cannot be empty'),
  shadowBranch: z.string().min(1, 'Shadow branch is required and cannot be empty'),
  brokerUrl: z.string().min(1, 'Broker URL is required and cannot be empty'),
  networks: z.array(z.string()).min(1, 'At least one network is required'),
  debounceMs: z.number().positive('Debounce delay must be a positive number').optional()
});

// ============================================================================
// Shadow Agent Factory
// ============================================================================

/**
 * Factory class for creating shadow agents
 *
 * Provides a clean API for shadow agent instantiation with validated configuration.
 * Follows the same factory pattern as WorkerAgentFactory for consistency.
 *
 * The factory performs Zod schema validation on configuration before creating agents,
 * ensuring type safety and providing descriptive error messages for invalid configurations.
 *
 * Usage Pattern:
 * 1. Call ShadowAgentFactory.createAgent(config) with your configuration
 * 2. If validation passes, receive a configured BaseShadowAgent instance
 * 3. Call agent.start() to begin monitoring and backup operations
 * 4. Call agent.stop() when done to cleanup resources
 *
 * @example Minimal Configuration
 * ```typescript
 * const agent = ShadowAgentFactory.createAgent({
 *   role: 'artist',
 *   workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   shadowWorktreePath: 'C:/p4/Personal/SD/shadow-artist-backup',
 *   workerBranch: 'main',
 *   shadowBranch: 'shadow-main',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi']
 * });
 *
 * await agent.start();
 * console.log('Shadow agent is now monitoring worker worktree');
 * ```
 *
 * @example With Optional Debounce Configuration
 * ```typescript
 * const agent = ShadowAgentFactory.createAgent({
 *   role: 'designer',
 *   workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-designer',
 *   shadowWorktreePath: 'C:/p4/Personal/SD/shadow-designer-backup',
 *   workerBranch: 'develop',
 *   shadowBranch: 'shadow-develop',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi', 'production'],
 *   debounceMs: 2000 // Wait 2 seconds after last change
 * });
 *
 * await agent.start();
 * // Agent monitors for 2 seconds after each change before creating backup
 * ```
 *
 * @example Error Handling with Validation
 * ```typescript
 * try {
 *   const agent = ShadowAgentFactory.createAgent({
 *     role: '', // Empty role will fail validation
 *     workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *     shadowWorktreePath: 'C:/p4/Personal/SD/shadow-artist-backup',
 *     workerBranch: 'main',
 *     shadowBranch: 'shadow-main',
 *     brokerUrl: 'ws://localhost:8080/kadi',
 *     networks: []  // Empty networks array will fail validation
 *   });
 * } catch (error) {
 *   console.error('Configuration validation failed:', error.message);
 *   // Output: "Role is required and cannot be empty"
 * }
 * ```
 */
export class ShadowAgentFactory {
  /**
   * Create a shadow agent with validated configuration
   *
   * Static factory method for instantiating shadow agents with Zod schema validation.
   * Validates all required configuration fields and provides descriptive error messages
   * for invalid configurations.
   *
   * The method performs the following steps:
   * 1. Validates configuration using ShadowAgentConfigSchema
   * 2. If validation passes, creates BaseShadowAgent instance
   * 3. Returns fully configured agent ready for start()
   *
   * Note: This method does NOT automatically start the agent. Caller must explicitly
   * call agent.start() to begin monitoring and backup operations.
   *
   * @param config - Shadow agent configuration to validate and use
   * @returns Configured BaseShadowAgent instance ready for start()
   * @throws {ZodError} If configuration validation fails with detailed error messages
   *
   * @example Minimal Configuration
   * ```typescript
   * const agent = ShadowAgentFactory.createAgent({
   *   role: 'artist',
   *   workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
   *   shadowWorktreePath: 'C:/p4/Personal/SD/shadow-artist-backup',
   *   workerBranch: 'main',
   *   shadowBranch: 'shadow-main',
   *   brokerUrl: 'ws://localhost:8080/kadi',
   *   networks: ['kadi']
   * });
   *
   * await agent.start();
   * ```
   *
   * @example With Optional Configuration
   * ```typescript
   * const agent = ShadowAgentFactory.createAgent({
   *   role: 'programmer',
   *   workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-programmer',
   *   shadowWorktreePath: 'C:/p4/Personal/SD/shadow-programmer-backup',
   *   workerBranch: 'feature/new-api',
   *   shadowBranch: 'shadow-feature',
   *   brokerUrl: 'ws://localhost:8080/kadi',
   *   networks: ['kadi', 'staging'],
   *   debounceMs: 3000 // Custom debounce delay
   * });
   *
   * await agent.start();
   * ```
   */
  static createAgent(config: ShadowAgentConfig, baseAgent?: BaseAgent): BaseShadowAgent {
    // Validate configuration with Zod schema
    // Throws ZodError with descriptive messages if validation fails
    const validatedConfig = ShadowAgentConfigSchema.parse(config);

    // Create and return BaseShadowAgent instance with validated config
    return new BaseShadowAgent(validatedConfig, baseAgent);
  }
}

/**
 * Create a shadow agent with configuration
 *
 * Convenience function for instantiating shadow agents.
 * Delegates to ShadowAgentFactory.createAgent().
 *
 * @param config - Shadow agent configuration
 * @returns Configured BaseShadowAgent instance
 *
 * @example
 * ```typescript
 * const agent = createShadowAgent({
 *   role: 'artist',
 *   workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *   shadowWorktreePath: 'C:/p4/Personal/SD/shadow-agent-playground-artist',
 *   workerBranch: 'agent-artist',
 *   shadowBranch: 'shadow-agent-artist',
 *   brokerUrl: 'ws://localhost:8080/kadi',
 *   networks: ['kadi']
 * });
 * await agent.start();
 * ```
 */
export function createShadowAgent(config: ShadowAgentConfig, baseAgent?: BaseAgent): BaseShadowAgent {
  return ShadowAgentFactory.createAgent(config, baseAgent);
}
