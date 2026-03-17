/**
 * @fileoverview Git CLI operations barrel export
 * @module services/git/providers/cli/operations
 */

// Core operations (repository fundamentals)
export { executeInit } from './core/init.js';
export { executeClone } from './core/clone.js';
export { executeStatus } from './core/status.js';
export { executeClean } from './core/clean.js';

// Staging operations (working tree → index)
export { executeAdd } from './staging/add.js';
export { executeReset } from './staging/reset.js';

// Commit operations (commit history)
export { executeCommit } from './commits/commit.js';
export { executeLog } from './commits/log.js';
export { executeShow } from './commits/show.js';
export { executeDiff } from './commits/diff.js';

// Branch operations
export { executeBranch } from './branches/branch.js';
export { executeCheckout } from './branches/checkout.js';
export { executeMerge } from './branches/merge.js';
export { executeRebase } from './branches/rebase.js';
export { executeCherryPick } from './branches/cherry-pick.js';

// Remote operations
export { executeRemote } from './remotes/remote.js';
export { executeFetch } from './remotes/fetch.js';
export { executePush } from './remotes/push.js';
export { executePull } from './remotes/pull.js';

// Tag operations
export { executeTag } from './tags/tag.js';

// Stash operations
export { executeStash } from './stash/stash.js';

// Worktree operations
export { executeWorktree } from './worktree/worktree.js';

// History inspection operations
export { executeBlame } from './history/blame.js';
export { executeReflog } from './history/reflog.js';
