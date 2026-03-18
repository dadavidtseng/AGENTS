/**
 * @fileoverview Git provider interface - contract for all git implementations
 * @module services/git/core/IGitProvider
 *
 * This interface defines the contract that all git providers must implement.
 * Providers can use different underlying implementations:
 * - CLI Provider: Wraps native git binary (full feature set, local only)
 * - Isomorphic Provider: Uses isomorphic-git (core features, edge-compatible)
 * - Future: GitHub API Provider, GitLab API Provider, etc.
 */

import type {
  GitOperationContext,
  GitProviderCapabilities,
  // Repository operations
  GitInitOptions,
  GitInitResult,
  GitCloneOptions,
  GitCloneResult,
  GitCleanOptions,
  GitCleanResult,
  // Status & information
  GitStatusOptions,
  GitStatusResult,
  // Commit operations
  GitAddOptions,
  GitAddResult,
  GitCommitOptions,
  GitCommitResult,
  GitLogOptions,
  GitLogResult,
  GitShowOptions,
  GitShowResult,
  GitDiffOptions,
  GitDiffResult,
  // Branch operations
  GitBranchOptions,
  GitBranchResult,
  GitCheckoutOptions,
  GitCheckoutResult,
  GitMergeOptions,
  GitMergeResult,
  GitRebaseOptions,
  GitRebaseResult,
  GitCherryPickOptions,
  GitCherryPickResult,
  // Remote operations
  GitRemoteOptions,
  GitRemoteResult,
  GitFetchOptions,
  GitFetchResult,
  GitPushOptions,
  GitPushResult,
  GitPullOptions,
  GitPullResult,
  // Tag operations
  GitTagOptions,
  GitTagResult,
  // Stash operations
  GitStashOptions,
  GitStashResult,
  // Worktree operations
  GitWorktreeOptions,
  GitWorktreeResult,
  // Additional operations
  GitResetOptions,
  GitResetResult,
  GitBlameOptions,
  GitBlameResult,
  GitReflogOptions,
  GitReflogResult,
} from '../types.js';

/**
 * Provider interface for git operations.
 *
 * All methods are async and throw McpError on failure.
 * Implementations should handle their own error transformation
 * from provider-specific errors to McpError.
 *
 * @example
 * ```typescript
 * const provider = await factory.getProvider();
 * const status = await provider.status(
 *   { includeUntracked: true },
 *   { requestContext, workingDirectory, tenantId }
 * );
 * ```
 */
export interface IGitProvider {
  /**
   * Provider name for logging and diagnostics
   *
   * Examples: 'cli', 'isomorphic', 'github-api'
   */
  readonly name: string;

  /**
   * Provider version
   */
  readonly version: string;

  /**
   * Capabilities supported by this provider
   *
   * Consumers can check capabilities before calling methods:
   * ```typescript
   * if (provider.capabilities.blame) {
   *   const result = await provider.blame(options, context);
   * }
   * ```
   */
  readonly capabilities: GitProviderCapabilities;

  /**
   * Check if provider is available and functional in current environment.
   *
   * This is called during provider selection to verify the provider
   * can operate in the current environment.
   *
   * @param context - Operation context (may use mock values for health check)
   * @returns Promise resolving to true if provider is healthy
   *
   * @example
   * ```typescript
   * const healthy = await provider.healthCheck(mockContext);
   * if (!healthy) {
   *   logger.warn('Provider failed health check');
   * }
   * ```
   */
  healthCheck(context: GitOperationContext): Promise<boolean>;

  // ========================================================================
  // Repository Operations
  // ========================================================================

  /**
   * Initialize a new git repository.
   *
   * @param options - Initialization options
   * @param context - Operation context
   * @returns Promise resolving to initialization result
   * @throws {McpError} If initialization fails
   */
  init(
    options: GitInitOptions,
    context: GitOperationContext,
  ): Promise<GitInitResult>;

  /**
   * Clone a repository from a remote URL.
   *
   * @param options - Clone options including remote URL and local path
   * @param context - Operation context
   * @returns Promise resolving to clone result
   * @throws {McpError} If clone fails
   */
  clone(
    options: GitCloneOptions,
    context: GitOperationContext,
  ): Promise<GitCloneResult>;

  /**
   * Get repository status (staged, unstaged, untracked files).
   *
   * @param options - Status options
   * @param context - Operation context
   * @returns Promise resolving to status information
   * @throws {McpError} If status operation fails
   */
  status(
    options: GitStatusOptions,
    context: GitOperationContext,
  ): Promise<GitStatusResult>;

  /**
   * Clean untracked files from working directory.
   *
   * @param options - Clean options (requires force: true for safety)
   * @param context - Operation context
   * @returns Promise resolving to clean result
   * @throws {McpError} If clean operation fails
   */
  clean(
    options: GitCleanOptions,
    context: GitOperationContext,
  ): Promise<GitCleanResult>;

  // ========================================================================
  // Commit Operations
  // ========================================================================

  /**
   * Stage files for commit.
   *
   * @param options - Files to stage and staging options
   * @param context - Operation context
   * @returns Promise resolving to add result
   * @throws {McpError} If add operation fails
   */
  add(
    options: GitAddOptions,
    context: GitOperationContext,
  ): Promise<GitAddResult>;

  /**
   * Create a new commit.
   *
   * @param options - Commit options including message
   * @param context - Operation context
   * @returns Promise resolving to commit information
   * @throws {McpError} If commit fails
   */
  commit(
    options: GitCommitOptions,
    context: GitOperationContext,
  ): Promise<GitCommitResult>;

  /**
   * View commit history.
   *
   * @param options - Log options (filters, limits, etc.)
   * @param context - Operation context
   * @returns Promise resolving to commit list
   * @throws {McpError} If log operation fails
   */
  log(
    options: GitLogOptions,
    context: GitOperationContext,
  ): Promise<GitLogResult>;

  /**
   * Show details of a git object (commit, tree, blob, tag).
   *
   * @param options - Object to show and format options
   * @param context - Operation context
   * @returns Promise resolving to object details
   * @throws {McpError} If show operation fails
   */
  show(
    options: GitShowOptions,
    context: GitOperationContext,
  ): Promise<GitShowResult>;

  /**
   * View differences between commits/files.
   *
   * @param options - Diff options (commits to compare, paths, etc.)
   * @param context - Operation context
   * @returns Promise resolving to diff output
   * @throws {McpError} If diff operation fails
   */
  diff(
    options: GitDiffOptions,
    context: GitOperationContext,
  ): Promise<GitDiffResult>;

  // ========================================================================
  // Branch Operations
  // ========================================================================

  /**
   * Manage branches (list/create/delete/rename).
   *
   * @param options - Branch operation options
   * @param context - Operation context
   * @returns Promise resolving to branch operation result
   * @throws {McpError} If branch operation fails
   */
  branch(
    options: GitBranchOptions,
    context: GitOperationContext,
  ): Promise<GitBranchResult>;

  /**
   * Switch branches or restore files.
   *
   * @param options - Checkout target and options
   * @param context - Operation context
   * @returns Promise resolving to checkout result
   * @throws {McpError} If checkout fails
   */
  checkout(
    options: GitCheckoutOptions,
    context: GitOperationContext,
  ): Promise<GitCheckoutResult>;

  /**
   * Merge branches.
   *
   * @param options - Branch to merge and merge options
   * @param context - Operation context
   * @returns Promise resolving to merge result
   * @throws {McpError} If merge fails or has conflicts
   */
  merge(
    options: GitMergeOptions,
    context: GitOperationContext,
  ): Promise<GitMergeResult>;

  /**
   * Rebase commits onto another branch.
   *
   * @param options - Rebase target and options
   * @param context - Operation context
   * @returns Promise resolving to rebase result
   * @throws {McpError} If rebase fails or has conflicts
   */
  rebase(
    options: GitRebaseOptions,
    context: GitOperationContext,
  ): Promise<GitRebaseResult>;

  /**
   * Cherry-pick commits.
   *
   * @param options - Commits to cherry-pick
   * @param context - Operation context
   * @returns Promise resolving to cherry-pick result
   * @throws {McpError} If cherry-pick fails or has conflicts
   */
  cherryPick(
    options: GitCherryPickOptions,
    context: GitOperationContext,
  ): Promise<GitCherryPickResult>;

  // ========================================================================
  // Remote Operations
  // ========================================================================

  /**
   * Manage remotes (list/add/remove/rename).
   *
   * @param options - Remote operation options
   * @param context - Operation context
   * @returns Promise resolving to remote operation result
   * @throws {McpError} If remote operation fails
   */
  remote(
    options: GitRemoteOptions,
    context: GitOperationContext,
  ): Promise<GitRemoteResult>;

  /**
   * Fetch updates from remote repository.
   *
   * @param options - Fetch options (remote, prune, etc.)
   * @param context - Operation context
   * @returns Promise resolving to fetch result
   * @throws {McpError} If fetch fails
   */
  fetch(
    options: GitFetchOptions,
    context: GitOperationContext,
  ): Promise<GitFetchResult>;

  /**
   * Push changes to remote repository.
   *
   * @param options - Push options (remote, branch, force, etc.)
   * @param context - Operation context
   * @returns Promise resolving to push result
   * @throws {McpError} If push fails or is rejected
   */
  push(
    options: GitPushOptions,
    context: GitOperationContext,
  ): Promise<GitPushResult>;

  /**
   * Pull changes from remote repository.
   *
   * @param options - Pull options (remote, branch, rebase, etc.)
   * @param context - Operation context
   * @returns Promise resolving to pull result
   * @throws {McpError} If pull fails or has conflicts
   */
  pull(
    options: GitPullOptions,
    context: GitOperationContext,
  ): Promise<GitPullResult>;

  // ========================================================================
  // Tag Operations
  // ========================================================================

  /**
   * Manage tags (list/create/delete).
   *
   * @param options - Tag operation options
   * @param context - Operation context
   * @returns Promise resolving to tag operation result
   * @throws {McpError} If tag operation fails
   */
  tag(
    options: GitTagOptions,
    context: GitOperationContext,
  ): Promise<GitTagResult>;

  // ========================================================================
  // Stash Operations
  // ========================================================================

  /**
   * Manage stashes (list/push/pop/apply/drop/clear).
   *
   * @param options - Stash operation options
   * @param context - Operation context
   * @returns Promise resolving to stash operation result
   * @throws {McpError} If stash operation fails
   */
  stash(
    options: GitStashOptions,
    context: GitOperationContext,
  ): Promise<GitStashResult>;

  // ========================================================================
  // Worktree Operations
  // ========================================================================

  /**
   * Manage worktrees (list/add/remove/move/prune).
   *
   * @param options - Worktree operation options
   * @param context - Operation context
   * @returns Promise resolving to worktree operation result
   * @throws {McpError} If worktree operation fails
   */
  worktree(
    options: GitWorktreeOptions,
    context: GitOperationContext,
  ): Promise<GitWorktreeResult>;

  // ========================================================================
  // Additional Operations
  // ========================================================================

  /**
   * Validate if a given path is a valid Git repository.
   *
   * This method checks if the specified path is within a git working directory.
   * It's used by tools that need to verify repository validity before operations.
   *
   * @param path - The absolute path to check
   * @param context - Operation context for logging
   * @returns Promise resolving to void if valid (throws on failure)
   * @throws {McpError} If the path is not a valid git repository
   *
   * @example
   * ```typescript
   * await provider.validateRepository('/path/to/repo', context);
   * // Throws McpError if not a git repository
   * ```
   */
  validateRepository(path: string, context: GitOperationContext): Promise<void>;

  /**
   * Reset current HEAD to specified state.
   *
   * @param options - Reset mode and target
   * @param context - Operation context
   * @returns Promise resolving to reset result
   * @throws {McpError} If reset fails
   */
  reset(
    options: GitResetOptions,
    context: GitOperationContext,
  ): Promise<GitResetResult>;

  /**
   * Show line-by-line authorship information for a file.
   *
   * @param options - File to blame and blame options
   * @param context - Operation context
   * @returns Promise resolving to blame information
   * @throws {McpError} If blame fails or is unsupported
   */
  blame(
    options: GitBlameOptions,
    context: GitOperationContext,
  ): Promise<GitBlameResult>;

  /**
   * View reference logs (reflog) to track reference updates.
   *
   * @param options - Reference and limit options
   * @param context - Operation context
   * @returns Promise resolving to reflog entries
   * @throws {McpError} If reflog fails or is unsupported
   */
  reflog(
    options: GitReflogOptions,
    context: GitOperationContext,
  ): Promise<GitReflogResult>;
}
