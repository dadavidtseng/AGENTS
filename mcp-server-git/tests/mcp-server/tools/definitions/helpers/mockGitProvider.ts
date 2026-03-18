/**
 * @fileoverview Mock Git provider implementation for testing tools in isolation.
 * @module tests/mcp-server/tools/definitions/helpers/mockGitProvider
 */
import { vi } from 'vitest';
import type { IGitProvider } from '@/services/git/core/IGitProvider.js';
import type {
  GitProviderCapabilities,
  GitOperationContext,
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
} from '@/services/git/types.js';

/**
 * Mock implementation of IGitProvider for testing.
 * All methods are vi.fn() spies that can be configured with return values or errors.
 */
export class MockGitProvider implements IGitProvider {
  readonly name = 'mock';
  readonly version = '1.0.0-test';
  readonly capabilities: GitProviderCapabilities = {
    init: true,
    clone: true,
    commit: true,
    branch: true,
    merge: true,
    rebase: true,
    remote: true,
    fetch: true,
    push: true,
    pull: true,
    tag: true,
    stash: true,
    worktree: true,
    blame: true,
    reflog: true,
    signCommits: true,
    sshAuth: true,
    httpAuth: true,
    maxRepoSizeMB: 1000,
  };

  // Repository operations
  init =
    vi.fn<
      (
        options: GitInitOptions,
        context: GitOperationContext,
      ) => Promise<GitInitResult>
    >();
  clone =
    vi.fn<
      (
        options: GitCloneOptions,
        context: GitOperationContext,
      ) => Promise<GitCloneResult>
    >();
  clean =
    vi.fn<
      (
        options: GitCleanOptions,
        context: GitOperationContext,
      ) => Promise<GitCleanResult>
    >();

  // Status & information
  status =
    vi.fn<
      (
        options: GitStatusOptions,
        context: GitOperationContext,
      ) => Promise<GitStatusResult>
    >();

  // Commit operations
  add =
    vi.fn<
      (
        options: GitAddOptions,
        context: GitOperationContext,
      ) => Promise<GitAddResult>
    >();
  commit =
    vi.fn<
      (
        options: GitCommitOptions,
        context: GitOperationContext,
      ) => Promise<GitCommitResult>
    >();
  log =
    vi.fn<
      (
        options: GitLogOptions,
        context: GitOperationContext,
      ) => Promise<GitLogResult>
    >();
  show =
    vi.fn<
      (
        options: GitShowOptions,
        context: GitOperationContext,
      ) => Promise<GitShowResult>
    >();
  diff =
    vi.fn<
      (
        options: GitDiffOptions,
        context: GitOperationContext,
      ) => Promise<GitDiffResult>
    >();

  // Branch operations
  branch =
    vi.fn<
      (
        options: GitBranchOptions,
        context: GitOperationContext,
      ) => Promise<GitBranchResult>
    >();
  checkout =
    vi.fn<
      (
        options: GitCheckoutOptions,
        context: GitOperationContext,
      ) => Promise<GitCheckoutResult>
    >();
  merge =
    vi.fn<
      (
        options: GitMergeOptions,
        context: GitOperationContext,
      ) => Promise<GitMergeResult>
    >();
  rebase =
    vi.fn<
      (
        options: GitRebaseOptions,
        context: GitOperationContext,
      ) => Promise<GitRebaseResult>
    >();
  cherryPick =
    vi.fn<
      (
        options: GitCherryPickOptions,
        context: GitOperationContext,
      ) => Promise<GitCherryPickResult>
    >();

  // Remote operations
  remote =
    vi.fn<
      (
        options: GitRemoteOptions,
        context: GitOperationContext,
      ) => Promise<GitRemoteResult>
    >();
  fetch =
    vi.fn<
      (
        options: GitFetchOptions,
        context: GitOperationContext,
      ) => Promise<GitFetchResult>
    >();
  push =
    vi.fn<
      (
        options: GitPushOptions,
        context: GitOperationContext,
      ) => Promise<GitPushResult>
    >();
  pull =
    vi.fn<
      (
        options: GitPullOptions,
        context: GitOperationContext,
      ) => Promise<GitPullResult>
    >();

  // Tag operations
  tag =
    vi.fn<
      (
        options: GitTagOptions,
        context: GitOperationContext,
      ) => Promise<GitTagResult>
    >();

  // Stash operations
  stash =
    vi.fn<
      (
        options: GitStashOptions,
        context: GitOperationContext,
      ) => Promise<GitStashResult>
    >();

  // Worktree operations
  worktree =
    vi.fn<
      (
        options: GitWorktreeOptions,
        context: GitOperationContext,
      ) => Promise<GitWorktreeResult>
    >();

  // Additional operations
  reset =
    vi.fn<
      (
        options: GitResetOptions,
        context: GitOperationContext,
      ) => Promise<GitResetResult>
    >();
  blame =
    vi.fn<
      (
        options: GitBlameOptions,
        context: GitOperationContext,
      ) => Promise<GitBlameResult>
    >();
  reflog =
    vi.fn<
      (
        options: GitReflogOptions,
        context: GitOperationContext,
      ) => Promise<GitReflogResult>
    >();

  /**
   * Health check - always returns true for mock provider
   */
  healthCheck = vi.fn(
    async (_context: GitOperationContext): Promise<boolean> => {
      return true;
    },
  );

  /**
   * Validate repository - mock implementation (no-op)
   */
  validateRepository = vi.fn(
    async (_path: string, _context: GitOperationContext): Promise<void> => {
      // Mock implementation - does nothing
    },
  );

  /**
   * Reset all method spies for clean test state
   */
  resetMocks(): void {
    this.init.mockReset();
    this.clone.mockReset();
    this.clean.mockReset();
    this.status.mockReset();
    this.add.mockReset();
    this.commit.mockReset();
    this.log.mockReset();
    this.show.mockReset();
    this.diff.mockReset();
    this.branch.mockReset();
    this.checkout.mockReset();
    this.merge.mockReset();
    this.rebase.mockReset();
    this.cherryPick.mockReset();
    this.remote.mockReset();
    this.fetch.mockReset();
    this.push.mockReset();
    this.pull.mockReset();
    this.tag.mockReset();
    this.stash.mockReset();
    this.worktree.mockReset();
    this.reset.mockReset();
    this.blame.mockReset();
    this.reflog.mockReset();
    this.healthCheck.mockReset();
    this.validateRepository.mockReset();
  }
}

/**
 * Factory function to create a fresh MockGitProvider instance
 */
export function createMockGitProvider(): MockGitProvider {
  return new MockGitProvider();
}
