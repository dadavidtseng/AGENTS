/**
 * Git Operations Handler — merge conflict detection and resolution
 *
 * Provides utilities for agent-lead to:
 * - Merge task worktree branches into a staging branch
 * - Detect and auto-resolve simple merge conflicts
 * - Escalate complex conflicts to HUMAN via agent-producer
 *
 * All git operations are performed via mcp-server-git invokeRemote calls.
 * File I/O (conflict resolution) uses ability-file-local via loadNative.
 *
 * @module handlers/git-operations
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { ProviderManager, Message } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';

/** Native ability handle returned by KadiClient.loadNative() */
type NativeAbility = Awaited<ReturnType<KadiClient['loadNative']>>;

// ============================================================================
// Types
// ============================================================================

/** Result of a merge attempt */
export interface MergeResult {
  success: boolean;
  conflicts: boolean;
  conflictedFiles: string[];
  mergedFiles: string[];
  message: string;
}

/** Result of conflict resolution */
export interface ConflictResolutionResult {
  resolved: boolean;
  autoResolved: string[];
  escalated: string[];
  message: string;
}

/** Overall result of a merge-and-resolve operation */
export interface MergeOperationResult {
  merge: MergeResult;
  resolution?: ConflictResolutionResult;
  finalCommit?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** File patterns that can be auto-resolved by accepting "theirs" (incoming) */
const AUTO_THEIRS_PATTERNS = [
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

/** File patterns that can be auto-resolved by accepting "ours" (current) */
const AUTO_OURS_PATTERNS = [
  /\.env$/,
  /\.env\.local$/,
];

// ============================================================================
// Git Tool Wrappers
// ============================================================================

/** Parse mcp-server-git response content — handles both JSON and plain text */
function parseGitResponse(result: { content: Array<{ type: string; text: string }> }): any {
  const text = result.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    // Response is plain text (e.g. error message) — wrap it
    return { success: false, message: text };
  }
}

/**
 * Set the working directory for subsequent git operations.
 */
async function setWorkingDir(client: KadiClient, path: string): Promise<void> {
  await client.invokeRemote('git_git_set_working_dir', { path });
}

/**
 * Get repository status including conflicted files.
 */
async function getStatus(client: KadiClient, path: string): Promise<{
  currentBranch: string;
  isClean: boolean;
  conflictedFiles: string[];
  stagedChanges: string[];
  unstagedChanges: string[];
}> {
  const result = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('git_git_status', { path });
  return parseGitResponse(result);
}

/**
 * Merge a branch into the current branch.
 */
async function mergeBranch(client: KadiClient, path: string, branch: string, message?: string): Promise<MergeResult> {
  try {
    const result = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('git_git_merge', {
      path,
      branch,
      noFastForward: true,
      message: message ?? `Merge ${branch}`,
    });

    const data = parseGitResponse(result);

    // MCP server may return conflict info as non-JSON text in the response
    // body instead of throwing. Detect conflicts from the message text so
    // the caller can proceed to conflict resolution.
    if (data.success === false && data.message) {
      const msg: string = data.message;
      if (msg.includes('CONFLICT') || msg.includes('conflict')) {
        const conflictedFiles: string[] = [];
        const conflictPattern = /CONFLICT.*?:\s*Merge conflict in\s+(.+?)$/gm;
        let match: RegExpExecArray | null;
        while ((match = conflictPattern.exec(msg)) !== null) {
          // Extract just the filename, strip any leading git metadata (SHAs, etc)
          const raw = match[1].trim();
          // Git may prefix with SHAs like "abc123 def456 path/to/file.txt"
          // Take the last token (the actual file path)
          const tokens = raw.split(/\s+/);
          const filename = tokens[tokens.length - 1];
          if (filename) conflictedFiles.push(filename);
        }
        logger.info(
          MODULE_AGENT,
          `Detected ${conflictedFiles.length} conflicted file(s) from response: ${conflictedFiles.join(', ')}`,
          timer.elapsed('main'),
        );
        return {
          success: false,
          conflicts: true,
          conflictedFiles,
          mergedFiles: [],
          message: msg,
        };
      }
    }

    return {
      success: data.success ?? true,
      conflicts: data.conflicts ?? false,
      conflictedFiles: data.conflictedFiles ?? [],
      mergedFiles: data.mergedFiles ?? [],
      message: data.message ?? 'Merge completed',
    };
  } catch (err: any) {
    // Merge failure with conflicts still returns useful data
    // Debug: log the full error structure
    logger.info(MODULE_AGENT, `Merge error structure: ${JSON.stringify(err, null, 2).slice(0, 1000)}`, timer.elapsed('main'));
    
    // Extract text from all possible error locations
    const errorText = err.message || '';
    const stdoutText = err.stdout || '';
    const stderrText = err.stderr || '';
    
    // Check if error has content array (MCP response format)
    let contentText = '';
    if (err.content && Array.isArray(err.content)) {
      contentText = err.content.map((c: any) => c.text || '').join('\n');
    }
    
    // Combine all text sources - errorText already contains the full formatted output
    const combinedText = [errorText, stdoutText, stderrText, contentText].join('\n');
    
    logger.info(MODULE_AGENT, `Combined text length: ${combinedText.length}, contains CONFLICT: ${combinedText.includes('CONFLICT')}`, timer.elapsed('main'));
    
    if (combinedText.includes('CONFLICT') || combinedText.includes('conflict')) {
      // Extract conflicted filenames from error message (e.g. "CONFLICT (add/add): Merge conflict in demo/index.html")
      const conflictedFiles: string[] = [];
      const conflictPattern = /CONFLICT.*?:\s*Merge conflict in (.+)/g;
      let match: RegExpExecArray | null;
      while ((match = conflictPattern.exec(combinedText)) !== null) {
        conflictedFiles.push(match[1].trim());
      }

      logger.info(MODULE_AGENT, `Detected ${conflictedFiles.length} conflicted file(s): ${conflictedFiles.join(', ')}`, timer.elapsed('main'));

      return {
        success: false,
        conflicts: true,
        conflictedFiles,
        mergedFiles: [],
        message: errorText || 'Merge conflict detected',
      };
    }
    
    // Not a conflict error - re-throw
    logger.error(MODULE_AGENT, `Merge failed (non-conflict): ${errorText}`, timer.elapsed('main'));
    throw err;
  }
}

/**
 * Checkout a file using ours/theirs strategy to resolve conflict.
 */
async function checkoutFile(
  client: KadiClient,
  path: string,
  file: string,
  strategy: 'ours' | 'theirs',
): Promise<void> {
  await client.invokeRemote('git_git_checkout', {
    path,
    files: [file],
    [strategy]: true,
  });
}

/**
 * Stage resolved files.
 */
async function stageFiles(client: KadiClient, path: string, files: string[]): Promise<void> {
  await client.invokeRemote('git_git_add', { path, files });
}

/**
 * Create a commit.
 */
async function commit(client: KadiClient, path: string, message: string): Promise<string> {
  const result = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('git_git_commit', { path, message });
  const data = parseGitResponse(result);
  return data.commitHash ?? '';
}

/**
 * Abort an in-progress merge.
 */
async function abortMerge(client: KadiClient, path: string): Promise<void> {
  await client.invokeRemote('git_git_merge', { path, abort: true });
}

// ============================================================================
// Conflict Resolution Logic
// ============================================================================

/**
 * Determine if a conflicted file can be auto-resolved.
 * Returns 'ours', 'theirs', or null (needs manual/escalation).
 */
function classifyConflict(filePath: string): 'ours' | 'theirs' | null {
  for (const pattern of AUTO_THEIRS_PATTERNS) {
    if (pattern.test(filePath)) return 'theirs';
  }
  for (const pattern of AUTO_OURS_PATTERNS) {
    if (pattern.test(filePath)) return 'ours';
  }
  return null;
}

/**
 * Read a file's content from the working tree (with conflict markers if mid-merge).
 * Uses ability-file-local via loadNative (in-process, zero-latency).
 */
async function readFileContent(
  nativeFileLocal: NativeAbility | null | undefined,
  repoPath: string,
  filePath: string,
): Promise<string | null> {
  const fullPath = `${repoPath}/${filePath}`;
  if (!nativeFileLocal) {
    logger.warn(MODULE_AGENT, `  No file ability — cannot read ${filePath}`, timer.elapsed('main'));
    return null;
  }
  try {
    logger.info(MODULE_AGENT, `  Reading ${filePath} via native ability`, timer.elapsed('main'));
    const result = await nativeFileLocal.invoke('read_file', { filePath: fullPath, encoding: 'text' }) as {
      success?: boolean; content?: string;
    };
    if (result?.success && result.content) {
      logger.info(MODULE_AGENT, `  Read ${filePath}, length: ${result.content.length}`, timer.elapsed('main'));
      return result.content;
    }
    logger.warn(MODULE_AGENT, `  read_file returned no content for ${filePath}`, timer.elapsed('main'));
    return null;
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `  readFileContent failed for ${filePath}: ${err.message}`, timer.elapsed('main'));
    return null;
  }
}

/**
 * Write resolved content to a file in the working tree.
 * Uses ability-file-local via loadNative (in-process, zero-latency).
 */
async function writeFileContent(
  nativeFileLocal: NativeAbility | null | undefined,
  repoPath: string,
  filePath: string,
  content: string,
): Promise<void> {
  const fullPath = `${repoPath}/${filePath}`;
  if (!nativeFileLocal) throw new Error('No file ability — cannot write file');
  await nativeFileLocal.invoke('create_file', { filePath: fullPath, content });
}

/**
 * Attempt LLM-based merge conflict resolution.
 * Reads the file with conflict markers, sends to LLM for intelligent merge,
 * writes the resolved content back, and stages it.
 * Returns true if successful, false if LLM can't resolve.
 */
async function llmMergeConflict(
  client: KadiClient,
  repoPath: string,
  filePath: string,
  providerManager: ProviderManager,
  nativeFileLocal?: NativeAbility | null,
): Promise<boolean> {
  const conflictContent = await readFileContent(nativeFileLocal, repoPath, filePath);
  if (!conflictContent) {
    logger.warn(MODULE_AGENT, `  LLM merge skipped for ${filePath}: could not read file content`, timer.elapsed('main'));
    return false;
  }
  if (!conflictContent.includes('<<<<<<<')) {
    logger.warn(MODULE_AGENT, `  LLM merge skipped for ${filePath}: no conflict markers found`, timer.elapsed('main'));
    return false;
  }

  const messages: Message[] = [
    {
      role: 'system',
      content:
        'You are a senior developer resolving a git merge conflict. ' +
        'The file contains standard git conflict markers (<<<<<<< ======= >>>>>>>). ' +
        'Produce the correctly merged file content that preserves the intent of BOTH sides. ' +
        'Output ONLY the resolved file content — no explanations, no markdown fences. ' +
        'If you cannot confidently merge, respond with exactly: CANNOT_RESOLVE',
    },
    {
      role: 'user',
      content: `File: ${filePath}\n\n${conflictContent}`,
    },
  ];

  try {
    const result = await providerManager.chat(messages, { maxTokens: 4096 });
    if (!result.success || !result.data) return false;

    const resolved = result.data.trim();
    if (resolved === 'CANNOT_RESOLVE' || resolved.includes('<<<<<<<')) {
      return false;
    }

    await writeFileContent(nativeFileLocal, repoPath, filePath, resolved);
    await stageFiles(client, repoPath, [filePath]);

    logger.info(MODULE_AGENT, `  LLM-resolved ${filePath}`, timer.elapsed('main'));
    return true;
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `  LLM merge failed for ${filePath}: ${err.message}`, timer.elapsed('main'));
    return false;
  }
}

/**
 * Attempt to auto-resolve conflicts for files matching known patterns.
 * Returns which files were resolved and which need escalation.
 */
async function resolveConflicts(
  client: KadiClient,
  repoPath: string,
  conflictedFiles: string[],
  providerManager?: ProviderManager | null,
  nativeFileLocal?: NativeAbility | null,
): Promise<ConflictResolutionResult> {
  const autoResolved: string[] = [];
  const escalated: string[] = [];

  for (const file of conflictedFiles) {
    const strategy = classifyConflict(file);

    if (strategy) {
      try {
        await checkoutFile(client, repoPath, file, strategy);
        await stageFiles(client, repoPath, [file]);
        autoResolved.push(file);
        logger.info(
          MODULE_AGENT,
          `  Auto-resolved ${file} (${strategy})`,
          timer.elapsed('main'),
        );
      } catch (err: any) {
        logger.warn(
          MODULE_AGENT,
          `  Failed to auto-resolve ${file}: ${err.message}`,
          timer.elapsed('main'),
        );
        escalated.push(file);
      }
    } else if (providerManager) {
      // Try LLM-based merge before escalating
      const resolved = await llmMergeConflict(client, repoPath, file, providerManager, nativeFileLocal);
      if (resolved) {
        autoResolved.push(file);
      } else {
        escalated.push(file);
      }
    } else {
      escalated.push(file);
    }
  }

  const resolved = escalated.length === 0;
  const message = resolved
    ? `All ${autoResolved.length} conflict(s) auto-resolved`
    : `${autoResolved.length} auto-resolved, ${escalated.length} need manual resolution`;

  return { resolved, autoResolved, escalated, message };
}

// ============================================================================
// Escalation
// ============================================================================

/**
 * Escalate unresolvable conflicts to HUMAN via agent-producer.
 * Publishes a conflict.escalation event with details.
 */
async function escalateToHuman(
  client: KadiClient,
  questId: string,
  branch: string,
  targetBranch: string,
  escalatedFiles: string[],
  agentId: string,
): Promise<void> {
  await client.publish('conflict.escalation', {
    questId,
    branch,
    targetBranch,
    conflictedFiles: escalatedFiles,
    message: `Merge conflict in ${escalatedFiles.length} file(s) requires manual resolution`,
    timestamp: new Date().toISOString(),
    escalatedBy: agentId,
  }, { broker: 'default', network: 'producer' });

  logger.warn(
    MODULE_AGENT,
    `Escalated ${escalatedFiles.length} conflict(s) to HUMAN: ${escalatedFiles.join(', ')}`,
    timer.elapsed('main'),
  );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Merge a task branch into the staging branch with conflict resolution.
 *
 * Flow:
 * 1. Set working directory
 * 2. Attempt merge
 * 3. If conflicts, try auto-resolution
 * 4. If auto-resolution succeeds, commit the merge
 * 5. If auto-resolution fails, escalate to HUMAN and abort merge
 *
 * @param client       - Connected KadiClient
 * @param repoPath     - Path to the git repository
 * @param taskBranch   - Branch to merge (e.g. "task/quest-123/task-1")
 * @param questId      - Quest ID for escalation context
 * @param agentId      - This agent-lead's identity
 * @param targetBranch - Branch to merge into (defaults to current branch)
 */
export async function mergeTaskBranch(
  client: KadiClient,
  repoPath: string,
  taskBranch: string,
  questId: string,
  agentId: string,
  targetBranch?: string,
  providerManager?: ProviderManager | null,
  nativeFileLocal?: NativeAbility | null,
): Promise<MergeOperationResult> {
  logger.info(
    MODULE_AGENT,
    `Merging ${taskBranch} into ${targetBranch ?? 'current branch'} at ${repoPath}`,
    timer.elapsed('main'),
  );

  // Set working directory
  await setWorkingDir(client, repoPath);

  // Attempt merge
  const merge = await mergeBranch(
    client,
    repoPath,
    taskBranch,
    `Merge ${taskBranch} (quest: ${questId})`,
  );

  if (merge.success && !merge.conflicts) {
    logger.info(MODULE_AGENT, `Merge clean — no conflicts`, timer.elapsed('main'));
    return { merge };
  }

  if (!merge.success && !merge.conflicts) {
    // Merge failed for a non-conflict reason (e.g. git error)
    logger.error(MODULE_AGENT, `Merge failed: ${merge.message}`, timer.elapsed('main'));
    return { merge };
  }

  // Conflicts detected — get full list from status if merge didn't return them
  let conflictedFiles = merge.conflictedFiles;
  if (conflictedFiles.length === 0) {
    const status = await getStatus(client, repoPath);
    conflictedFiles = status.conflictedFiles;
  }

  logger.warn(
    MODULE_AGENT,
    `Merge conflicts in ${conflictedFiles.length} file(s): ${conflictedFiles.join(', ')}`,
    timer.elapsed('main'),
  );

  // Attempt auto-resolution (pattern-based + LLM fallback)
  const resolution = await resolveConflicts(client, repoPath, conflictedFiles, providerManager, nativeFileLocal);

  if (resolution.resolved) {
    // All conflicts resolved — commit
    const commitHash = await commit(
      client,
      repoPath,
      `Merge ${taskBranch} (auto-resolved conflicts)`,
    );
    logger.info(
      MODULE_AGENT,
      `Merge committed after auto-resolution: ${commitHash}`,
      timer.elapsed('main'),
    );
    return { merge, resolution, finalCommit: commitHash };
  }

  // Escalate remaining conflicts
  await escalateToHuman(
    client,
    questId,
    taskBranch,
    targetBranch ?? 'staging',
    resolution.escalated,
    agentId,
  );

  // Abort the merge to leave repo in clean state
  await abortMerge(client, repoPath);
  logger.info(MODULE_AGENT, `Merge aborted — waiting for HUMAN resolution`, timer.elapsed('main'));

  return { merge, resolution };
}

/**
 * Check if a repository has ongoing merge conflicts.
 */
export async function hasMergeConflicts(
  client: KadiClient,
  repoPath: string,
): Promise<{ hasConflicts: boolean; files: string[] }> {
  const status = await getStatus(client, repoPath);
  return {
    hasConflicts: status.conflictedFiles.length > 0,
    files: status.conflictedFiles,
  };
}
