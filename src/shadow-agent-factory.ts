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
import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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
   * - Event topic construction (shadow-{role}.backup.completed)
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
   * Filesystem watcher instance for monitoring worker worktree
   *
   * Monitors file operations (create, modify, delete) in worker worktree.
   * Null until start() is called.
   */
  private fsWatcher: FSWatcher | null = null;

  /**
   * Git ref watcher instance for monitoring worker branch commits
   *
   * Watches .git/refs/heads/{workerBranch} file for commit SHA changes.
   * Uses fs.watch (not chokidar) for lightweight ref monitoring.
   * Null until start() is called.
   */
  private refWatcher: fs.FSWatcher | null = null;

  /**
   * Previous commit SHA from worker branch
   *
   * Stores last known commit SHA to detect actual commit changes.
   * Used to differentiate real commits from other ref updates.
   * Null until first commit is detected.
   */
  private previousCommitSha: string | null = null;

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
   * Debounce timeout for git ref watcher
   *
   * Stores timeout handle for debouncing ref change events.
   * Prevents processing rapid ref updates.
   */
  private refDebounceTimeout: NodeJS.Timeout | null = null;

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
  constructor(config: ShadowAgentConfig) {
    // Store configuration
    this.config = config;
    this.role = config.role;
    this.workerWorktreePath = config.workerWorktreePath;
    this.shadowWorktreePath = config.shadowWorktreePath;
    this.workerBranch = config.workerBranch;
    this.shadowBranch = config.shadowBranch;
    this.debounceMs = config.debounceMs || 1000;

    // Initialize KĀDI client
    this.client = new KadiClient({
      name: `shadow-agent-${config.role}`,
      version: '1.0.0',
      role: 'agent',
      broker: config.brokerUrl,
      networks: config.networks
    });

    console.log(`🔧 BaseShadowAgent initialized for role: ${this.role}`);
    console.log(`   Worker worktree: ${this.workerWorktreePath}`);
    console.log(`   Shadow worktree: ${this.shadowWorktreePath}`);
    console.log(`   Worker branch: ${this.workerBranch}`);
    console.log(`   Shadow branch: ${this.shadowBranch}`);
    console.log(`   Debounce delay: ${this.debounceMs}ms`);
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
    console.log(`🚀 Starting shadow agent for role: ${this.role}`);

    // Connect to KĀDI broker (non-blocking)
    console.log('   → Connecting to KĀDI broker...');
    void this.client.serve('broker').catch((error: any) => {
      console.error('❌ Broker connection error:', error);
      process.exit(1);
    });

    // Wait a moment for broker connection to establish
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('   ✅ Connected to KĀDI broker');

    // Setup filesystem watcher for worker worktree
    await this.setupFilesystemWatcher();
    console.log('✅ Filesystem watcher initialized');

    // Setup git ref watcher for worker branch
    await this.setupGitRefWatcher();
    console.log('✅ Git ref watcher initialized');

    console.log('✅ Shadow agent started and monitoring');
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
    console.log(`🛑 Stopping shadow agent for role: ${this.role}`);

    // Stop filesystem watcher
    if (this.fsWatcher) {
      console.log('🛑 Stopping filesystem watcher...');
      await this.fsWatcher.close();
      this.fsWatcher = null;
      console.log('✅ Filesystem watcher stopped');
    }

    // Stop git ref watcher
    if (this.refWatcher) {
      console.log('🛑 Stopping git ref watcher...');
      this.refWatcher.close();
      this.refWatcher = null;
      console.log('✅ Git ref watcher stopped');
    }

    // Clear ref debounce timeout
    if (this.refDebounceTimeout) {
      console.log('🛑 Clearing ref debounce timeout...');
      clearTimeout(this.refDebounceTimeout);
      this.refDebounceTimeout = null;
      console.log('✅ Ref debounce timeout cleared');
    }

    // Clear all pending debounce timers
    if (this.debounceMap.size > 0) {
      console.log(`🛑 Clearing ${this.debounceMap.size} pending debounce timers...`);
      for (const timeout of this.debounceMap.values()) {
        clearTimeout(timeout);
      }
      this.debounceMap.clear();
      console.log('✅ Debounce timers cleared');
    }

    // Disconnect KĀDI client
    console.log('   → Disconnecting from KĀDI broker...');
    await this.client.disconnect();
    console.log('   ✅ Disconnected from KĀDI broker');

    console.log('✅ Shadow agent stopped');
  }

  /**
   * Setup filesystem watcher for worker worktree
   *
   * Monitors worker worktree for file operations (create, modify, delete) using chokidar.
   * File changes are debounced and stored for batch backup processing.
   *
   * Configuration:
   * - Watches: config.workerWorktreePath
   * - Excludes: .git directory, node_modules, .env files
   * - Debounce: config.debounceMs (default: 1000ms)
   * - Stability threshold: Waits for file writes to complete
   *
   * Event Handling:
   * - 'add': File created in worktree
   * - 'change': Existing file modified
   * - 'unlink': File deleted from worktree
   * - 'error': Watcher errors (logged but non-fatal)
   * - 'ready': Watcher initialization complete
   *
   * Debouncing Strategy:
   * - Stores timeout handle in debounceMap for each file
   * - Clears previous timeout if file changes again before debounce completes
   * - Only processes file after debounceMs of inactivity
   * - Prevents rapid-fire commits for the same file
   *
   * @throws {Error} If watcher initialization fails
   *
   * @example
   * ```typescript
   * await this.setupFilesystemWatcher();
   * // Watcher is now monitoring worker worktree for file changes
   * ```
   */
  protected async setupFilesystemWatcher(): Promise<void> {
    console.log(`👁️  Setting up filesystem watcher: ${this.workerWorktreePath}`);

    // Create chokidar watcher with configuration
    this.fsWatcher = chokidar.watch(this.workerWorktreePath, {
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files on startup
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.git',  // Also ignore .git file (for worktrees)
        '**/.env',
        '**/.env.*'
      ],
      awaitWriteFinish: {
        stabilityThreshold: this.debounceMs,
        pollInterval: 100
      }
    });

    // Event: File created
    this.fsWatcher.on('add', (filePath: string) => {
      console.log(`➕ File created: ${filePath}`);

      // Debounce to avoid rapid-fire commits
      if (this.debounceMap.has(filePath)) {
        clearTimeout(this.debounceMap.get(filePath)!);
      }

      const timeout = setTimeout(async () => {
        console.log(`📝 Processing created file: ${filePath}`);
        const relativePath = path.relative(this.workerWorktreePath, filePath);
        await this.createShadowBackup('Created', relativePath);
        this.debounceMap.delete(filePath);
      }, this.debounceMs);

      this.debounceMap.set(filePath, timeout);
    });

    // Event: File modified
    this.fsWatcher.on('change', (filePath: string) => {
      console.log(`✏️  File modified: ${filePath}`);

      // Debounce to avoid rapid-fire commits
      if (this.debounceMap.has(filePath)) {
        clearTimeout(this.debounceMap.get(filePath)!);
      }

      const timeout = setTimeout(async () => {
        console.log(`📝 Processing modified file: ${filePath}`);
        const relativePath = path.relative(this.workerWorktreePath, filePath);
        await this.createShadowBackup('Modified', relativePath);
        this.debounceMap.delete(filePath);
      }, this.debounceMs);

      this.debounceMap.set(filePath, timeout);
    });

    // Event: File deleted
    this.fsWatcher.on('unlink', (filePath: string) => {
      console.log(`🗑️  File deleted: ${filePath}`);

      // Debounce to avoid rapid-fire commits
      if (this.debounceMap.has(filePath)) {
        clearTimeout(this.debounceMap.get(filePath)!);
      }

      const timeout = setTimeout(async () => {
        console.log(`📝 Processing deleted file: ${filePath}`);
        const relativePath = path.relative(this.workerWorktreePath, filePath);
        await this.createShadowBackup('Deleted', relativePath);
        this.debounceMap.delete(filePath);
      }, this.debounceMs);

      this.debounceMap.set(filePath, timeout);
    });

    // Event: Watcher error
    this.fsWatcher.on('error', (error: unknown) => {
      console.error('❌ Filesystem watcher error:', error);
      // Non-fatal - watcher continues operating
    });

    // Event: Watcher ready
    this.fsWatcher.on('ready', () => {
      console.log('✅ Filesystem watcher ready');
    });
  }

  /**
   * Setup git ref watcher for worker branch commits
   *
   * Monitors worker branch ref file (.git/refs/heads/{workerBranch}) for commit SHA changes
   * using fs.watch. Detects new commits and triggers createShadowBackup after debounce period.
   *
   * Architecture:
   * - Uses fs.watch (not chokidar) for lightweight ref monitoring
   * - Reads commit SHA from ref file on each change
   * - Compares with previousCommitSha to detect actual commits
   * - Debounces to handle rapid ref updates (e.g., during rebase)
   * - Triggers backup only for real commit changes
   *
   * Ref File Location:
   * - {workerWorktreePath}/.git/refs/heads/{workerBranch}
   * - Contains commit SHA as plain text (40 hex characters)
   * - Updated by git on each commit to branch
   *
   * Change Detection Strategy:
   * 1. fs.watch fires on any ref file modification
   * 2. Read current SHA from ref file
   * 3. Compare with previousCommitSha
   * 4. If different, debounce and trigger backup
   * 5. Update previousCommitSha for next comparison
   *
   * Debouncing:
   * - Uses config.debounceMs delay (default: 1000ms)
   * - Clears previous timeout if ref changes again
   * - Prevents multiple backups during rapid commits
   *
   * @throws {Error} If ref file doesn't exist or can't be watched
   *
   * @example
   * ```typescript
   * await this.setupGitRefWatcher();
   * // Watcher is now monitoring worker branch for commits
   * ```
   */
  protected async setupGitRefWatcher(): Promise<void> {
    // Construct path to worker branch ref file
    const refFilePath = path.join(
      this.workerWorktreePath,
      '.git/refs/heads',
      this.workerBranch
    );

    console.log(`👁️  Setting up git ref watcher: ${refFilePath}`);

    // Verify ref file exists before watching
    if (!fs.existsSync(refFilePath)) {
      console.warn(`⚠️  Ref file not found: ${refFilePath}`);
      console.warn(`   Worker branch may not exist yet. Skipping ref watcher setup.`);
      return;
    }

    // Read initial commit SHA
    try {
      this.previousCommitSha = fs.readFileSync(refFilePath, 'utf-8').trim();
      console.log(`📋 Initial commit SHA: ${this.previousCommitSha.substring(0, 7)}`);
    } catch (error: any) {
      console.error(`❌ Failed to read initial commit SHA: ${error.message}`);
      this.previousCommitSha = null;
    }

    // Setup fs.watch for ref file
    try {
      this.refWatcher = fs.watch(refFilePath, (eventType, _filename) => {
        // Handle 'change' and 'rename' events (rename can occur during git operations)
        if (eventType !== 'change' && eventType !== 'rename') {
          return;
        }

        console.log(`🔄 Git ref change detected: ${eventType}`);

        // Clear previous debounce timeout
        if (this.refDebounceTimeout) {
          clearTimeout(this.refDebounceTimeout);
        }

        // Debounce to handle rapid ref updates
        this.refDebounceTimeout = setTimeout(async () => {
          try {
            // Read current commit SHA from ref file
            const currentSha = fs.readFileSync(refFilePath, 'utf-8').trim();

            // Check if SHA actually changed (ignore non-commit ref updates)
            if (currentSha === this.previousCommitSha) {
              console.log(`ℹ️  Ref updated but SHA unchanged - skipping`);
              return;
            }

            console.log(`🔄 Worker commit detected on ${this.workerBranch}`);
            console.log(`   Previous SHA: ${this.previousCommitSha?.substring(0, 7) || 'none'}`);
            console.log(`   Current SHA:  ${currentSha.substring(0, 7)}`);

            // Update tracked SHA
            this.previousCommitSha = currentSha;

            // Trigger shadow backup for commit
            await this.createShadowBackup('COMMIT', `Commit ${currentSha.substring(0, 7)}`);

          } catch (error: any) {
            console.error(`❌ Failed to process ref change: ${error.message}`);
            // Non-fatal - watcher continues operating
          }
        }, this.debounceMs);
      });

      console.log('✅ Git ref watcher ready');

    } catch (error: any) {
      console.error(`❌ Failed to setup git ref watcher: ${error.message}`);
      this.refWatcher = null;
      // Non-fatal - agent continues with filesystem watching only
    }

    // Handle watcher errors
    this.refWatcher?.on('error', (error: unknown) => {
      console.error('❌ Git ref watcher error:', error);
      // Non-fatal - watcher may auto-recover
    });
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
    console.log(`📦 Creating shadow backup: ${operation} - ${fileName}`);

    // Check circuit breaker state before attempting git operations
    if (this.checkCircuitBreaker()) {
      console.warn(`⚠️  Circuit breaker open - skipping backup operation`);
      return;
    }

    try {
      // For COMMIT operations, parse worker commit and copy changed files
      if (operation === 'COMMIT') {
        console.log(`📋 Processing worker commit mirror...`);

        // Step 1: Get latest commit hash from worker worktree
        const commitHash = execSync('git log -1 --format=%H', {
          cwd: this.workerWorktreePath,
          encoding: 'utf-8'
        }).trim();

        console.log(`   Worker commit SHA: ${commitHash.substring(0, 7)}`);

        // Step 2: Get commit message from worker
        const commitMessage = execSync('git log -1 --format=%B', {
          cwd: this.workerWorktreePath,
          encoding: 'utf-8'
        }).trim();

        console.log(`   Worker commit message: ${commitMessage}`);

        // Step 3: Get list of changed files using git diff
        let changedFiles: string[] = [];
        try {
          const diffOutput = execSync('git diff --name-only HEAD~1 HEAD', {
            cwd: this.workerWorktreePath,
            encoding: 'utf-8'
          }).trim();

          changedFiles = diffOutput ? diffOutput.split('\n').filter(f => f.trim()) : [];
          console.log(`   Changed files: ${changedFiles.length} file(s)`);
        } catch (diffError: any) {
          // Handle case where there's no parent commit (initial commit)
          if (diffError.message.includes('unknown revision')) {
            console.log(`   Initial commit detected - getting all files`);
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
            console.log(`   ✓ Copied: ${file}`);
          } catch (copyError: any) {
            // File may have been deleted - that's ok, git will handle it
            console.log(`   ℹ️  Could not copy ${file}: ${copyError.message}`);
          }
        }

        // Step 5: Stage all changes in shadow worktree
        execSync('git add -A', {
          cwd: this.shadowWorktreePath,
          encoding: 'utf-8'
        });

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

        console.log(`✅ Shadow commit created: ${shadowCommitHash.substring(0, 7)}`);

        // Record success and reset failure count
        this.recordGitSuccess();

        // Publish backup success event using standardized method
        await this.publishBackupStatus(true, changedFiles, 'mirror-commit');

      } else {
        // For file operations (Created, Modified, Deleted), handle individual file
        console.log(`📋 Processing file operation: ${operation} - ${fileName}`);

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
          console.log(`   ✓ Copied: ${fileName}`);
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

        console.log(`✅ Shadow backup commit created: ${commitHash.substring(0, 7)}`);

        // Record success and reset failure count
        this.recordGitSuccess();

        // Publish backup success event using standardized method
        await this.publishBackupStatus(true, [fileName], `file-${operation.toLowerCase()}`);
      }

    } catch (error: any) {
      console.error(`❌ Shadow backup failed: ${error.message}`);

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
   * and failure scenarios. Events follow topic pattern: shadow-{role}.backup.{completed|failed}.
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
    // Construct topic with shadow- prefix
    const topic = `shadow-${this.role}.backup.${success ? 'completed' : 'failed'}`;

    // Create payload matching BackupEvent schema
    const payload: {
      role: string;
      operation: string;
      status: 'success' | 'failure';
      filesBackedUp: string[];
      error?: string;
      timestamp: string;
    } = {
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
    this.client.publishEvent(topic, payload);
    console.log(`📤 Published backup ${success ? 'success' : 'failure'} event to ${topic}`);
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
    console.error(`❌ Git operation failed (${this.gitFailureCount}/${this.MAX_GIT_FAILURES}): ${operation}`, error.message);

    if (this.gitFailureCount >= this.MAX_GIT_FAILURES) {
      this.gitCircuitOpen = true;
      console.error(`🚨 Circuit breaker opened - too many git failures`);

      // Auto-reset circuit after timeout
      setTimeout(() => {
        this.gitCircuitOpen = false;
        this.gitFailureCount = 0;
        console.log(`🔄 Circuit breaker reset - retrying git operations`);
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
 * ShadowAgentConfigSchema.parse(validConfig); // ✅ Passes validation
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
 *     role: '', // ❌ Empty role will fail validation
 *     workerWorktreePath: 'C:/p4/Personal/SD/agent-playground-artist',
 *     shadowWorktreePath: 'C:/p4/Personal/SD/shadow-artist-backup',
 *     workerBranch: 'main',
 *     shadowBranch: 'shadow-main',
 *     brokerUrl: 'ws://localhost:8080/kadi',
 *     networks: []  // ❌ Empty networks array will fail validation
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
  static createAgent(config: ShadowAgentConfig): BaseShadowAgent {
    // Validate configuration with Zod schema
    // Throws ZodError with descriptive messages if validation fails
    const validatedConfig = ShadowAgentConfigSchema.parse(config);

    // Create and return BaseShadowAgent instance with validated config
    return new BaseShadowAgent(validatedConfig);
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
export function createShadowAgent(config: ShadowAgentConfig): BaseShadowAgent {
  return ShadowAgentFactory.createAgent(config);
}
