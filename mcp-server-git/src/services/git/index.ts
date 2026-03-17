/**
 * @fileoverview Git service barrel exports
 * @module services/git
 *
 * This module provides a centralized export point for all git service
 * components. Import from this module instead of individual files.
 */

// Core interfaces and types
export type { IGitProvider } from './core/IGitProvider.js';
export { BaseGitProvider } from './core/BaseGitProvider.js';
export {
  GitProviderFactory,
  GitProviderType,
  type GitProviderOptions,
} from './core/GitProviderFactory.js';

// All type definitions
export type {
  // Base
  GitOperationContext,
  GitProviderCapabilities,
  // Repository
  GitInitOptions,
  GitInitResult,
  GitCloneOptions,
  GitCloneResult,
  GitCleanOptions,
  GitCleanResult,
  // Status
  GitStatusOptions,
  GitStatusResult,
  // Commits
  GitAddOptions,
  GitAddResult,
  GitCommitOptions,
  GitCommitResult,
  GitLogOptions,
  GitLogResult,
  GitCommitInfo,
  GitShowOptions,
  GitShowResult,
  GitDiffOptions,
  GitDiffResult,
  // Branches
  GitBranchOptions,
  GitBranchResult,
  GitBranchInfo,
  GitCheckoutOptions,
  GitCheckoutResult,
  GitMergeOptions,
  GitMergeResult,
  GitRebaseOptions,
  GitRebaseResult,
  GitCherryPickOptions,
  GitCherryPickResult,
  // Remotes
  GitRemoteOptions,
  GitRemoteResult,
  GitRemoteInfo,
  GitFetchOptions,
  GitFetchResult,
  GitPushOptions,
  GitPushResult,
  GitPullOptions,
  GitPullResult,
  // Tags
  GitTagOptions,
  GitTagResult,
  GitTagInfo,
  // Stash
  GitStashOptions,
  GitStashResult,
  GitStashInfo,
  // Worktree
  GitWorktreeOptions,
  GitWorktreeResult,
  GitWorktreeInfo,
  // Additional
  GitResetOptions,
  GitResetResult,
  GitBlameOptions,
  GitBlameResult,
  GitBlameLine,
  GitReflogOptions,
  GitReflogResult,
  GitReflogEntry,
} from './types.js';

// Provider implementations
export { CliGitProvider } from './providers/cli/index.js';
// Future providers:
// export { IsomorphicGitProvider } from './providers/isomorphic/index.js';
// export { GitHubApiProvider } from './providers/github-api/index.js';
// export { GitLabApiProvider } from './providers/gitlab-api/index.js';
