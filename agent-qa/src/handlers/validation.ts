/**
 * Validation Handler — automated quality gate for task review
 *
 * Subscribes to task.review_requested events from worker agents.
 * Runs semantic + behavioral validation, produces structured scores,
 * and publishes task.validated or task.revision_needed.
 *
 * Validation chain: worker → agent-qa (LLM deep review) → agent-lead (final verify)
 *
 * @module handlers/validation
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { KadiClient, BrokerEvent } from '@kadi.build/core';
import type {
  TaskValidatedPayload,
  TaskRevisionNeededPayload,
} from 'agents-library';
import {
  TaskReviewRequestedPayloadSchema,
} from 'agents-library';
import type { ProviderManager, Message, ChatOptions } from 'agents-library';
import type { MemoryService } from 'agents-library';
import { formatMemoryContext } from 'agents-library';
import {
  analyzeValidationNeeds,
  validateGameState,
  validateGameScreenshot,
  validateGameBuild,
} from './game-validation.js';

// ============================================================================
// Types
// ============================================================================

/** Task type determines which validation strategy to apply */
export type TaskType = 'code' | 'art' | 'build' | 'unknown';

/** Severity level for validation results */
export type Severity = 'PASS' | 'WARN' | 'FAIL';

/** Structured validation result */
export interface ValidationResult {
  taskId: string;
  questId: string;
  score: number;
  severity: Severity;
  feedback: string;
  checks: ValidationCheck[];
}

/** Individual validation check */
export interface ValidationCheck {
  name: string;
  passed: boolean;
  score: number;
  detail: string;
}

// ============================================================================
// Constants
// ============================================================================

const TOPIC_REVIEW_REQUESTED = 'task.review_requested';
const TOPIC_VALIDATED = 'task.validated';
const TOPIC_REVISION_NEEDED = 'task.revision_needed';
const PASS_THRESHOLD = 70;
const WARN_THRESHOLD = 50;

// ============================================================================
// Native File-Local Helper
// ============================================================================

/**
 * Invoke a file-local tool — natively if available, otherwise via broker.
 * Strips the broker `file_` prefix for native invocation.
 */
async function invokeFileLocal<T>(
  client: KadiClient,
  nativeFileLocal: any | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (nativeFileLocal && toolName.startsWith('file_')) {
    return await nativeFileLocal.invoke(toolName.slice(5), args);
  }
  return await client.invokeRemote<T>(toolName, args);
}

// ============================================================================
// Native Eval Helper
// ============================================================================

/**
 * Invoke an eval tool — natively if available, otherwise via broker.
 * eval_ is part of the tool name itself (not a broker prefix), so no stripping needed.
 */
async function invokeEval<T>(
  client: KadiClient,
  nativeEval: any | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (nativeEval) {
    return await nativeEval.invoke(toolName, args);
  }
  return await client.invokeRemote<T>(toolName, args);
}

// ============================================================================
// Native Vision Helper
// ============================================================================

/**
 * Invoke a vision tool — natively if available, otherwise via broker.
 * Strips the broker `vision_` prefix for native invocation.
 */
async function invokeVision<T>(
  client: KadiClient,
  nativeVision: any | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (nativeVision && toolName.startsWith('vision_')) {
    return await nativeVision.invoke(toolName.slice(7), args);
  }
  return await client.invokeRemote<T>(toolName, args);
}

// ============================================================================
// Native File-Cloud Helper
// ============================================================================

/**
 * Invoke a file-cloud tool — natively if available, otherwise via broker.
 * Strips the broker `cloud_` prefix for native invocation.
 */
async function invokeFileCloud<T>(
  client: KadiClient,
  nativeFileCloud: any | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (nativeFileCloud && toolName.startsWith('cloud_')) {
    return await nativeFileCloud.invoke(toolName.slice(6), args);
  }
  return await client.invokeRemote<T>(toolName, args);
}

// ============================================================================
// Native File-Remote Helper
// ============================================================================

/**
 * Invoke a file-remote tool — natively if available, otherwise via broker.
 * Strips the broker `remote_` prefix for native invocation.
 */
async function invokeFileRemote<T>(
  client: KadiClient,
  nativeFileRemote: any | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (nativeFileRemote && toolName.startsWith('remote_')) {
    return await nativeFileRemote.invoke(toolName.slice(7), args);
  }
  return await client.invokeRemote<T>(toolName, args);
}

// ============================================================================
// Task Type Detection
// ============================================================================

/**
 * Determine task type by querying quest for task metadata.
 * Falls back to 'code' if task type cannot be determined.
 */
async function detectTaskType(
  client: KadiClient,
  questId: string,
  taskId: string,
): Promise<TaskType> {
  try {
    const resp = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_quest', { questId, detail: 'full' });

    const questData = JSON.parse(resp.content[0].text);
    const task = (questData.tasks ?? []).find((t: any) => (t.id ?? t.taskId) === taskId);

    if (!task) {
      logger.warn(MODULE_AGENT, `detectTaskType: task ${taskId} not found in quest ${questId} (${(questData.tasks ?? []).length} tasks) — defaulting to 'code'`, timer.elapsed('main'));
      return 'code';
    }

    const role = (task.role ?? task.assignedTo ?? '').toLowerCase();
    logger.info(MODULE_AGENT, `detectTaskType: task ${taskId} role="${role}"`, timer.elapsed('main'));
    if (role.includes('artist')) return 'art';
    if (role.includes('builder')) return 'build';
    if (role.includes('designer')) return 'art';
    return 'code';
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `Failed to detect task type: ${err.message}`, timer.elapsed('main'));
    return 'code';
  }
}

// ============================================================================
// Diff Retrieval
// ============================================================================

/**
 * Retrieve git diff for a commit via mcp-server-git.
 * Prefers git_diff (purpose-built for diffs), falls back to git_show.
 */
async function getCommitDiff(
  client: KadiClient,
  commitHash: string,
  worktreePath: string,
): Promise<string> {
  // Try git_diff first: compare commitHash~1 → commitHash
  try {
    const resp = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('git_git_diff', {
      path: worktreePath,
      source: `${commitHash}~1`,
      target: commitHash,
    });

    const text = resp.content[0]?.text ?? '{}';
    const parsed = JSON.parse(text);
    if (parsed.diff && parsed.diff.trim().length > 0) {
      return parsed.diff;
    }
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `git_diff failed, trying git_show: ${err.message}`, timer.elapsed('main'));
  }

  // Fallback: git_show (content field holds the diff at standard+ verbosity)
  try {
    const resp = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('git_git_show', { path: worktreePath, object: commitHash });

    const text = resp.content[0]?.text ?? '{}';
    const parsed = JSON.parse(text);
    return parsed.content ?? parsed.diff ?? text;
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `Failed to get diff: ${err.message}`, timer.elapsed('main'));
    return '';
  }
}

/**
 * Retrieve task description and requirements from quest.
 */
async function getTaskDetails(
  client: KadiClient,
  questId: string,
  taskId: string,
): Promise<{ description: string; requirements: string }> {
  try {
    const resp = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('quest_quest_query_quest', { questId, detail: 'full' });

    const questData = JSON.parse(resp.content[0].text);
    const task = (questData.tasks ?? []).find((t: any) => (t.id ?? t.taskId) === taskId);

    return {
      description: task?.description ?? '',
      requirements: task?.implementationGuide ?? task?.description ?? '',
    };
  } catch {
    return { description: '', requirements: '' };
  }
}

// ============================================================================
// Ability-Eval Integration (structured evaluation via KĀDI broker)
// ============================================================================

/** Response shape from ability-eval tools */
interface EvalResponse {
  verdict: 'pass' | 'fail' | 'needs_improvement';
  score: number;
  criteria: Record<string, { score: number; notes: string }>;
  summary: string;
  suggestions: string[];
}

/**
 * Parse ability-eval response from MCP content format.
 * Returns null if the response is malformed or an error.
 */
function parseEvalResponse(resp: any): EvalResponse | null {
  try {
    // Handle direct JSON response (ability-eval returns unwrapped)
    if (resp?.verdict && typeof resp?.score === 'number') {
      logger.info(MODULE_AGENT, `parseEvalResponse: direct JSON format detected, score=${resp.score}`, timer.elapsed('main'));
      return resp as EvalResponse;
    }

    // Handle MCP-wrapped response
    const text = resp?.content?.[0]?.text;
    if (!text || text.startsWith('Error:')) {
      logger.warn(MODULE_AGENT, `parseEvalResponse: no text or error - text=${text?.slice(0, 200)}`, timer.elapsed('main'));
      return null;
    }
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (!parsed.verdict || typeof parsed.score !== 'number') {
      logger.warn(MODULE_AGENT, `parseEvalResponse: missing verdict or score - parsed=${JSON.stringify(parsed).slice(0, 300)}`, timer.elapsed('main'));
      return null;
    }
    return parsed as EvalResponse;
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `parseEvalResponse: JSON parse failed - ${err.message}`, timer.elapsed('main'));
    return null;
  }
}

/**
 * Run eval_code_diff via ability-eval on the KĀDI broker.
 * Evaluates code quality, correctness, security, and readability.
 */
async function validateCodeWithEval(
  client: KadiClient,
  nativeEval: any | null,
  diff: string,
  taskDescription: string,
  taskRequirements: string,
  pastPatterns?: string,
): Promise<ValidationCheck> {
  if (!diff) {
    return { name: 'eval-code-diff', passed: false, score: 0, detail: 'No diff available' };
  }

  const truncatedDiff = diff.length > 12000
    ? diff.slice(0, 12000) + '\n... (truncated)'
    : diff;

  try {
    const resp = await invokeEval(
      client,
      nativeEval ?? null,
      'eval_code_diff',
      {
        diff: truncatedDiff,
        context: `Task: ${taskDescription}\n\nRequirements:\n${taskRequirements}${pastPatterns ? `\n\nPast QA patterns (use to calibrate review):\n${pastPatterns}` : ''}`,
        criteria: 'correctness,completeness,quality,security,readability',
      },
    );

    logger.info(MODULE_AGENT, `eval_code_diff response: ${JSON.stringify(resp).slice(0, 500)}`, timer.elapsed('main'));

    const evalResult = parseEvalResponse(resp);
    if (!evalResult) {
      logger.warn(MODULE_AGENT, `eval_code_diff returned unparseable response, full response: ${JSON.stringify(resp).slice(0, 1000)}`, timer.elapsed('main'));
      return { name: 'eval-code-diff', passed: true, score: 55, detail: 'ability-eval returned unparseable response — defaulting to pass' };
    }

    const issues = evalResult.suggestions ?? [];
    return {
      name: 'eval-code-diff',
      passed: evalResult.score >= WARN_THRESHOLD,
      score: evalResult.score,
      detail: issues.length > 0
        ? `${evalResult.summary}. Suggestions: ${issues.join('; ')}`
        : evalResult.summary,
    };
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `eval_code_diff unavailable: ${err.message}`, timer.elapsed('main'));
    return null as any; // signal caller to use fallback
  }
}

/**
 * Run eval_task_completion via ability-eval on the KĀDI broker.
 * Checks whether deliverables satisfy the task requirements.
 */
async function validateTaskCompletion(
  client: KadiClient,
  nativeEval: any | null,
  taskRequirements: string,
  deliverables: string,
  evidence?: string,
): Promise<ValidationCheck> {
  try {
    const args: Record<string, string> = {
      task_requirements: taskRequirements,
      deliverables,
    };
    if (evidence) args.evidence = evidence;

    const resp = await invokeEval(client, nativeEval, 'eval_task_completion', args);

    logger.info(MODULE_AGENT, `eval_task_completion response: ${JSON.stringify(resp).slice(0, 500)}`, timer.elapsed('main'));

    const evalResult = parseEvalResponse(resp);
    if (!evalResult) {
      logger.warn(MODULE_AGENT, `eval_task_completion returned unparseable response, full response: ${JSON.stringify(resp).slice(0, 1000)}`, timer.elapsed('main'));
      return { name: 'eval-task-completion', passed: true, score: 55, detail: 'ability-eval returned unparseable response — defaulting to pass' };
    }

    return {
      name: 'eval-task-completion',
      passed: evalResult.verdict !== 'fail',
      score: evalResult.score,
      detail: evalResult.summary,
    };
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `eval_task_completion unavailable: ${err.message}`, timer.elapsed('main'));
    return null as any; // signal caller to use fallback
  }
}

// ============================================================================
// Screenshot Resolution
// ============================================================================

/** Configurable screenshot directory (DaemonAgent default) */
const SCREENSHOT_DIR = process.env.KADI_SCREENSHOT_DIR ?? 'C:/GitHub/DaemonAgent/Run/Screenshots';

/** Image file extensions to look for in diffs */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

/**
 * Resolve a screenshot for visual validation.
 * Returns a string usable by vision_describe_ui (file path, URL, or data URI).
 *
 * Priority:
 *   0. Explicit screenshotUri from payload (local path / remote / cloud / data URI / URL)
 *   1. Known screenshot directory (match by taskId or questId)
 *   2. Image files found in the commit diff
 */
async function resolveScreenshot(
  client: KadiClient,
  nativeFileLocal: any | null,
  nativeFileCloud: any | null,
  nativeFileRemote: any | null,
  questId: string,
  taskId: string,
  worktreePath: string,
  screenshotUri?: string,
): Promise<string | null> {
  // Strategy 0: Explicit URI from payload — dispatch by scheme
  if (screenshotUri) {
    const resolved = await resolveByUri(client, nativeFileLocal, nativeFileCloud, nativeFileRemote, screenshotUri);
    if (resolved) return resolved;
    logger.warn(MODULE_AGENT, `screenshotUri provided but unresolvable: ${screenshotUri}`, timer.elapsed('main'));
  }

  // Strategy 1: Check screenshot directory for matching files
  try {
    const dirResp = await invokeFileLocal<{
      content: Array<{ type: string; text: string }>;
    }>(client, nativeFileLocal, 'file_list_files_and_folders', { path: SCREENSHOT_DIR });

    const dirText = dirResp?.content?.[0]?.text;
    if (dirText && !dirText.startsWith('Error:')) {
      const parsed = JSON.parse(dirText);
      const files: string[] = Array.isArray(parsed)
        ? parsed
        : (parsed.files ?? parsed.entries ?? []).map((e: any) => typeof e === 'string' ? e : e.name);
      const match = files.find(
        (f) => (f.includes(taskId) || f.includes(questId))
          && IMAGE_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)),
      );
      if (match) {
        const screenshotPath = `${SCREENSHOT_DIR}/${match}`;
        logger.info(MODULE_AGENT, `Screenshot found in dir: ${screenshotPath}`, timer.elapsed('main'));
        return screenshotPath;
      }
    }
  } catch {
    // Screenshot directory not accessible — continue to next strategy
  }

  // Strategy 2: Look for image files in the commit diff
  try {
    const diffResp = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('git_git_diff', { path: worktreePath, commitHash: 'HEAD~1' });

    const diffText = diffResp?.content?.[0]?.text ?? '';
    const diffLines = diffText.split('\n');
    for (const line of diffLines) {
      if (!line.startsWith('diff --git')) continue;
      const filePath = line.split(' b/')[1];
      if (filePath && IMAGE_EXTENSIONS.some((ext) => filePath.toLowerCase().endsWith(ext))) {
        const fullPath = `${worktreePath}/${filePath}`;
        logger.info(MODULE_AGENT, `Screenshot from diff: ${fullPath}`, timer.elapsed('main'));
        return fullPath;
      }
    }
  } catch {
    // Diff lookup failed — no screenshot available
  }

  return null;
}

/**
 * Resolve a screenshotUri by its scheme.
 * Returns a value usable by vision_describe_ui (path, data URI, or URL).
 */
async function resolveByUri(client: KadiClient, nativeFileLocal: any | null, nativeFileCloud: any | null, nativeFileRemote: any | null, uri: string): Promise<string | null> {
  // Data URI — pass through directly
  if (uri.startsWith('data:')) return uri;

  // HTTP(S) URL — pass through (vision_describe_ui supports URLs)
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;

  // Cloud URI — download via ability-file-cloud, then read locally
  if (uri.startsWith('cloud://')) {
    return resolveCloudUri(client, nativeFileLocal, nativeFileCloud, uri);
  }

  // Remote URI — download via ability-file-remote, then read locally
  if (uri.startsWith('remote://')) {
    return resolveRemoteUri(client, nativeFileLocal, nativeFileRemote, uri);
  }

  // Plain local path or file:// — read via ability-file-local for base64
  const localPath = uri.startsWith('file://') ? uri.slice(7) : uri;
  return resolveLocalPath(client, nativeFileLocal, localPath);
}

/** Read a local image file via ability-file-local, returns data URI or null. */
async function resolveLocalPath(client: KadiClient, nativeFileLocal: any | null, filePath: string): Promise<string | null> {
  try {
    const resp = await invokeFileLocal<{
      content: Array<{ type: string; text: string }>;
    }>(client, nativeFileLocal, 'file_read_file', { filePath, encoding: 'base64' });

    const text = resp?.content?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (parsed.success && parsed.dataUri) {
      logger.info(MODULE_AGENT, `Local screenshot loaded: ${filePath}`, timer.elapsed('main'));
      return parsed.dataUri;
    }
    return null;
  } catch {
    logger.warn(MODULE_AGENT, `Failed to read local screenshot: ${filePath}`, timer.elapsed('main'));
    return null;
  }
}

/** Download from cloud (Dropbox etc.) via ability-file-cloud, then read locally. */
async function resolveCloudUri(client: KadiClient, nativeFileLocal: any | null, nativeFileCloud: any | null, uri: string): Promise<string | null> {
  // cloud://dropbox/path/to/file.png → provider=dropbox, remotePath=/path/to/file.png
  const withoutScheme = uri.slice('cloud://'.length);
  const slashIdx = withoutScheme.indexOf('/');
  if (slashIdx < 0) return null;

  const provider = withoutScheme.slice(0, slashIdx);
  const remotePath = withoutScheme.slice(slashIdx);
  const localTmp = `${SCREENSHOT_DIR}/_cloud_${Date.now()}.png`;

  try {
    await invokeFileCloud(client, nativeFileCloud, 'cloud_cloud_download_file', {
      provider,
      remotePath,
      localPath: localTmp,
    });
    logger.info(MODULE_AGENT, `Cloud screenshot downloaded: ${uri} → ${localTmp}`, timer.elapsed('main'));
    return resolveLocalPath(client, nativeFileLocal, localTmp);
  } catch {
    logger.warn(MODULE_AGENT, `Failed to download cloud screenshot: ${uri}`, timer.elapsed('main'));
    return null;
  }
}

/** Download from remote host via ability-file-remote, then read locally. */
async function resolveRemoteUri(client: KadiClient, nativeFileLocal: any | null, nativeFileRemote: any | null, uri: string): Promise<string | null> {
  // remote://host/path/to/file.png → host, remotePath=/path/to/file.png
  const withoutScheme = uri.slice('remote://'.length);
  const slashIdx = withoutScheme.indexOf('/');
  if (slashIdx < 0) return null;

  const host = withoutScheme.slice(0, slashIdx);
  const remotePath = withoutScheme.slice(slashIdx);
  const localTmp = `${SCREENSHOT_DIR}/_remote_${Date.now()}.png`;

  try {
    await invokeFileRemote(client, nativeFileRemote, 'remote_download_file_from_remote', {
      host,
      remotePath,
      localPath: localTmp,
    });
    logger.info(MODULE_AGENT, `Remote screenshot downloaded: ${uri} → ${localTmp}`, timer.elapsed('main'));
    return resolveLocalPath(client, nativeFileLocal, localTmp);
  } catch {
    logger.warn(MODULE_AGENT, `Failed to download remote screenshot: ${uri}`, timer.elapsed('main'));
    return null;
  }
}

// ============================================================================
// Visual Validation (ability-vision → ability-eval pipeline)
// ============================================================================

/**
 * Two-stage visual validation:
 *   Stage 1: vision_describe_ui → structured UI description
 *   Stage 2: eval_task_completion → score description against requirements
 *
 * Returns null if vision is unavailable (caller should fall back).
 */
async function validateVisual(
  client: KadiClient,
  nativeEval: any | null,
  nativeVision: any | null,
  screenshotPath: string,
  taskRequirements: string,
  taskDescription: string,
): Promise<ValidationCheck | null> {
  // Stage 1: Get UI description from ability-vision
  let uiDescription: string;
  try {
    const visionResp = await invokeVision<{
      content: Array<{ type: string; text: string }>;
    }>(client, nativeVision ?? null, 'vision_vision_describe_ui', {
      image: screenshotPath,
      focus: 'layout, components, colors, typography, accessibility',
    });

    const visionText = visionResp?.content?.[0]?.text;
    if (!visionText || visionText.startsWith('Error:')) {
      logger.warn(MODULE_AGENT, `vision_describe_ui failed: ${visionText}`, timer.elapsed('main'));
      return null;
    }
    uiDescription = visionText;
    logger.info(MODULE_AGENT, `Vision description: ${uiDescription.slice(0, 200)}...`, timer.elapsed('main'));
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `ability-vision unavailable: ${err.message}`, timer.elapsed('main'));
    return null;
  }

  // Stage 2: Evaluate description against requirements
  const completionCheck = await validateTaskCompletion(
    client,
    nativeEval ?? null,
    taskRequirements,
    `Visual analysis of UI output:\n${uiDescription}`,
    `Task: ${taskDescription}`,
  );

  if (!completionCheck) return null;

  return {
    name: 'visual-validation',
    passed: completionCheck.passed,
    score: completionCheck.score,
    detail: `[vision→eval] ${completionCheck.detail}`,
  };
}

// ============================================================================
// Semantic Validation (LLM-based) — legacy fallback
// ============================================================================

const CODE_REVIEW_SYSTEM = `You are a senior code reviewer for a multi-agent orchestration system (KĀDI).
Review the git diff against the task requirements. Evaluate:
1. Correctness: Does the code implement what was requested?
2. Completeness: Are all requirements addressed?
3. Quality: Code style, error handling, edge cases
4. Regressions: Could this break existing functionality?

Respond in JSON format:
{
  "score": <0-100>,
  "issues": ["issue1", "issue2"],
  "strengths": ["strength1"],
  "summary": "one-line summary"
}`;

/**
 * Run LLM-based semantic validation on a code diff.
 */
async function validateCodeSemantic(
  providerManager: ProviderManager,
  diff: string,
  taskDescription: string,
  taskRequirements: string,
  pastPatterns?: string,
): Promise<ValidationCheck> {
  if (!diff) {
    return { name: 'semantic', passed: false, score: 0, detail: 'No diff available for review' };
  }

  const truncatedDiff = diff.length > 12000 ? diff.slice(0, 12000) + '\n... (truncated)' : diff;

  const messages: Message[] = [
    {
      role: 'user',
      content: `## Task Description\n${taskDescription}\n\n## Requirements\n${taskRequirements}${pastPatterns ? `\n\n## Past QA Patterns\n${pastPatterns}` : ''}\n\n## Git Diff\n\`\`\`diff\n${truncatedDiff}\n\`\`\`\n\nReview this diff against the task requirements. Respond in JSON only.`,
    },
  ];

  const options: ChatOptions = {
    system: CODE_REVIEW_SYSTEM,
    maxTokens: 1024,
    temperature: 0.1,
  };

  const result = await providerManager.chat(messages, options);

  if (!result.success) {
    logger.warn(MODULE_AGENT, `LLM review failed: ${result.error.message}`, timer.elapsed('main'));
    return { name: 'semantic', passed: true, score: 60, detail: 'LLM review unavailable — defaulting to pass' };
  }

  try {
    const jsonMatch = result.data.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
    const score = Math.max(0, Math.min(100, parsed.score ?? 50));
    const issues = parsed.issues ?? [];
    const summary = parsed.summary ?? 'No summary';

    return {
      name: 'semantic',
      passed: score >= WARN_THRESHOLD,
      score,
      detail: issues.length > 0
        ? `${summary}. Issues: ${issues.join('; ')}`
        : summary,
    };
  } catch {
    return { name: 'semantic', passed: true, score: 55, detail: 'Failed to parse LLM response — defaulting to pass' };
  }
}

// ============================================================================
// Behavioral Validation (structural checks on the diff)
// ============================================================================

/**
 * Check that the diff is non-empty and contains meaningful changes.
 */
function validateDiffPresence(diff: string): ValidationCheck {
  if (!diff || diff.trim().length === 0) {
    return { name: 'diff-presence', passed: false, score: 0, detail: 'No diff found — commit may be empty' };
  }

  const addedLines = (diff.match(/^\+[^+]/gm) ?? []).length;
  const removedLines = (diff.match(/^-[^-]/gm) ?? []).length;

  if (addedLines === 0 && removedLines === 0) {
    return { name: 'diff-presence', passed: false, score: 10, detail: 'Diff contains no meaningful additions or removals' };
  }

  return { name: 'diff-presence', passed: true, score: 100, detail: `+${addedLines} -${removedLines} lines changed` };
}

/**
 * Check for common anti-patterns in the diff.
 */
function validateNoAntiPatterns(diff: string): ValidationCheck {
  const issues: string[] = [];

  // Check for debug leftovers
  const debugPatterns = [/console\.log\(/g, /debugger;/g, /TODO:\s*REMOVE/gi];
  for (const pattern of debugPatterns) {
    const matches = diff.match(pattern);
    if (matches && matches.length > 2) {
      issues.push(`Found ${matches.length} instances of ${pattern.source}`);
    }
  }

  // Check for large files added
  const fileHeaders = diff.match(/^\+\+\+ b\/.+/gm) ?? [];
  if (fileHeaders.length > 30) {
    issues.push(`${fileHeaders.length} files changed — unusually large changeset`);
  }

  if (issues.length === 0) {
    return { name: 'anti-patterns', passed: true, score: 100, detail: 'No anti-patterns detected' };
  }

  const score = Math.max(20, 100 - issues.length * 20);
  return { name: 'anti-patterns', passed: score >= WARN_THRESHOLD, score, detail: issues.join('; ') };
}

// ============================================================================
// Validation Orchestrator
// ============================================================================

/**
 * Run the full validation pipeline for a code task.
 */
async function validateCodeTask(
  client: KadiClient,
  nativeEval: any | null,
  providerManager: ProviderManager | undefined,
  questId: string,
  taskId: string,
  commitHash: string,
  worktreePath: string,
  pastPatterns?: string,
): Promise<ValidationResult> {
  const checks: ValidationCheck[] = [];

  // 1. Get diff and task details
  const diff = await getCommitDiff(client, commitHash, worktreePath);
  const { description, requirements } = await getTaskDetails(client, questId, taskId);

  // 2. Behavioral checks (no LLM needed)
  checks.push(validateDiffPresence(diff));
  checks.push(validateNoAntiPatterns(diff));

  // 3. Structured evaluation via ability-eval (preferred)
  let usedAbilityEval = false;

  const codeDiffCheck = await validateCodeWithEval(client, nativeEval ?? null, diff, description, requirements, pastPatterns);
  if (codeDiffCheck) {
    checks.push(codeDiffCheck);
    usedAbilityEval = true;
  }

  const completionCheck = await validateTaskCompletion(
    client, nativeEval ?? null, requirements, `Git diff from commit ${commitHash}`,
    diff ? diff.slice(0, 4000) : (pastPatterns || undefined),
  );
  if (completionCheck) {
    checks.push(completionCheck);
    usedAbilityEval = true;
  }

  // 4. Fallback: legacy LLM semantic review if ability-eval unavailable
  if (!usedAbilityEval) {
    if (providerManager) {
      const semanticCheck = await validateCodeSemantic(
        providerManager, diff, description, requirements, pastPatterns,
      );
      checks.push(semanticCheck);
    } else {
      checks.push({
        name: 'semantic', passed: true, score: 60,
        detail: 'No LLM provider and ability-eval unavailable — skipping semantic review',
      });
    }
  }

  // 5. Aggregate score (weighted average)
  const weights: Record<string, number> = usedAbilityEval
    ? { 'diff-presence': 0.1, 'anti-patterns': 0.1, 'eval-code-diff': 0.4, 'eval-task-completion': 0.4 }
    : { 'diff-presence': 0.2, 'anti-patterns': 0.2, 'semantic': 0.6 };

  let totalWeight = 0;
  let weightedScore = 0;

  for (const check of checks) {
    const w = weights[check.name] ?? 0.1;
    weightedScore += check.score * w;
    totalWeight += w;
  }

  const finalScore = Math.round(
    totalWeight > 0 ? weightedScore / totalWeight : 0,
  );
  const severity: Severity =
    finalScore >= PASS_THRESHOLD ? 'PASS'
    : finalScore >= WARN_THRESHOLD ? 'WARN'
    : 'FAIL';

  const failedChecks = checks.filter((c) => !c.passed);
  const feedback = failedChecks.length > 0
    ? failedChecks.map((c) => `[${c.name}] ${c.detail}`).join('\n')
    : 'All checks passed';

  return { taskId, questId, score: finalScore, severity, feedback, checks };
}

// ============================================================================
// Game Check Merge
// ============================================================================

/**
 * Merge game-specific checks into an existing validation result.
 * Game checks are weighted at 30% of the final score collectively,
 * and the original result is weighted at 70%.
 */
function mergeGameChecks(
  original: ValidationResult,
  gameChecks: ValidationCheck[],
): ValidationResult {
  const allChecks = [...original.checks, ...gameChecks];

  // Game checks collectively contribute 30% of final score
  const gameAvg = gameChecks.reduce((sum, c) => sum + c.score, 0) / gameChecks.length;
  const mergedScore = Math.round(original.score * 0.7 + gameAvg * 0.3);

  const severity: Severity =
    mergedScore >= PASS_THRESHOLD ? 'PASS'
    : mergedScore >= WARN_THRESHOLD ? 'WARN'
    : 'FAIL';

  const failedChecks = allChecks.filter((c) => !c.passed);
  const feedback = failedChecks.length > 0
    ? failedChecks.map((c) => `[${c.name}] ${c.detail}`).join('\n')
    : 'All checks passed (including game validation)';

  return {
    taskId: original.taskId,
    questId: original.questId,
    score: mergedScore,
    severity,
    feedback,
    checks: allChecks,
  };
}

// ============================================================================
// Event Handler Setup
// ============================================================================

/**
 * Set up the validation handler.
 *
 * Subscribes to task.review_requested on the qa network.
 * On each event: detect task type → run validation pipeline → publish result.
 */
export function setupValidationHandler(
  client: KadiClient,
  providerManager?: ProviderManager,
  memoryService?: MemoryService,
  nativeFileLocal?: any,
  nativeEval?: any,
  nativeVision?: any,
  nativeFileCloud?: any,
  nativeFileRemote?: any,
): void {
  logger.info(MODULE_AGENT, 'Setting up validation handler', timer.elapsed('main'));

  client.subscribe(TOPIC_REVIEW_REQUESTED, async (event: BrokerEvent) => {
    const timerKey = `validate-${Date.now()}`;
    timer.start(timerKey);

    try {
      // Parse incoming event payload
      const payload = TaskReviewRequestedPayloadSchema.parse(event.data);
      const { questId, taskId, commitHash, branch, revisionCount, screenshotUri } = payload;
      const worktreePath = branch ?? '';

      logger.info(
        MODULE_AGENT,
        `Review requested: quest=${questId} task=${taskId} commit=${commitHash} worktree=${worktreePath}`,
        timer.elapsed(timerKey),
      );

      // Detect task type for strategy selection
      const taskType = await detectTaskType(client, questId, taskId);
      logger.info(MODULE_AGENT, `Task type: ${taskType}`, timer.elapsed(timerKey));

      // Map task type to originating role for memory recall
      const taskRole = taskType === 'art' ? 'artist' : taskType === 'build' ? 'programmer' : 'programmer';

      // Recall past QA patterns for this task type (non-blocking, best-effort)
      let pastPatterns = '';
      if (memoryService) {
        try {
          const recallResult = await memoryService.recallRelevant(
            taskType,
            `QA validation for ${taskType} task ${taskId}`,
            taskRole,
            3,
            ['*'],
          );
          if (recallResult.success && recallResult.data.length > 0) {
            pastPatterns = formatMemoryContext(recallResult.data, 1500);
            logger.info(MODULE_AGENT, `Recalled ${recallResult.data.length} past QA patterns`, timer.elapsed(timerKey));
          }
        } catch (err: any) {
          logger.warn(MODULE_AGENT, `Memory recall failed (non-fatal): ${err.message}`, timer.elapsed(timerKey));
        }
      }

      // Get task details for content-based analysis
      const { description: taskDesc, requirements: taskReqs } = await getTaskDetails(client, questId, taskId);

      // Analyze task content to determine which validation checks apply
      const validationNeeds = analyzeValidationNeeds(taskDesc, taskReqs);
      logger.info(MODULE_AGENT, `Validation needs: ${JSON.stringify(validationNeeds)}`, timer.elapsed(timerKey));

      // Run content-driven validation pipeline
      // Base: always run diff-based code validation (works for all task types including design docs)
      // Layer: add visual/game checks based on content analysis
      let result: ValidationResult;

      if (validationNeeds.needsDiffReview) {
        // Diff-based pipeline: works for code, design docs, specs, etc.
        result = await validateCodeTask(
          client, nativeEval ?? null, providerManager, questId, taskId, commitHash, worktreePath, pastPatterns,
        );
      } else {
        // No diff needed — start with task completion check as baseline
        const baseChecks: ValidationCheck[] = [];
        const completionCheck = await validateTaskCompletion(
          client, nativeEval ?? null, taskReqs || taskDesc, `Deliverables for task ${taskId} (commit: ${commitHash})`,
        );
        if (completionCheck) {
          baseChecks.push(completionCheck);
        } else {
          baseChecks.push({ name: 'eval-task-completion', passed: true, score: 60, detail: 'ability-eval unavailable — defaulting to pass' });
        }

        const baseScore = baseChecks.reduce((sum, c) => sum + c.score, 0) / baseChecks.length;
        const baseSev: Severity = baseScore >= PASS_THRESHOLD ? 'PASS' : baseScore >= WARN_THRESHOLD ? 'WARN' : 'FAIL';
        const baseFailed = baseChecks.filter(c => !c.passed);
        result = {
          taskId, questId, score: Math.round(baseScore), severity: baseSev,
          feedback: baseFailed.length > 0 ? baseFailed.map(c => `[${c.name}] ${c.detail}`).join('\n') : 'Validation passed',
          checks: baseChecks,
        };
      }

      // Art-specific: add visual check if screenshot is available (regardless of task type)
      if (taskType === 'art' || screenshotUri) {
        const screenshot = await resolveScreenshot(client, nativeFileLocal ?? null, nativeFileCloud ?? null, nativeFileRemote ?? null, questId, taskId, worktreePath, screenshotUri);
        if (screenshot) {
          logger.info(MODULE_AGENT, `Running visual pipeline for task ${taskId}`, timer.elapsed(timerKey));
          const visualCheck = await validateVisual(client, nativeEval ?? null, nativeVision ?? null, screenshot, taskReqs || taskDesc, taskDesc);
          if (visualCheck) {
            result = mergeGameChecks(result, [visualCheck]);
          }
        }
      }

      // ----------------------------------------------------------------
      // Content-based game checks (appended to any task type)
      // ----------------------------------------------------------------
      const gameChecks: ValidationCheck[] = [];

      if (validationNeeds.needsGameState) {
        logger.info(MODULE_AGENT, `Running game state validation for task ${taskId}`, timer.elapsed(timerKey));
        gameChecks.push(await validateGameState(client, nativeEval ?? null, taskReqs || taskDesc));
      }

      if (validationNeeds.needsScreenshot) {
        logger.info(MODULE_AGENT, `Running game screenshot validation for task ${taskId}`, timer.elapsed(timerKey));
        gameChecks.push(await validateGameScreenshot(client, nativeEval ?? null, nativeVision ?? null, taskReqs || taskDesc, taskDesc, questId, taskId));
      }

      if (validationNeeds.needsBuild) {
        logger.info(MODULE_AGENT, `Running game build validation for task ${taskId}`, timer.elapsed(timerKey));
        gameChecks.push(await validateGameBuild(client));
      }

      // Merge game checks into result if any were run
      if (gameChecks.length > 0) {
        result = mergeGameChecks(result, gameChecks);
        logger.info(MODULE_AGENT, `Merged ${gameChecks.length} game checks — new score=${result.score} severity=${result.severity}`, timer.elapsed(timerKey));
      }

      logger.info(
        MODULE_AGENT,
        `Validation result: score=${result.score} severity=${result.severity} feedback=${result.feedback}`,
        timer.elapsed(timerKey),
      );

      // Publish result event
      if (result.severity === 'FAIL') {
        const revisionPayload: TaskRevisionNeededPayload = {
          questId,
          taskId,
          feedback: result.feedback,
          score: result.score,
          revisionCount: (revisionCount ?? 0) + 1,
        };
        await client.publish(TOPIC_REVISION_NEEDED, revisionPayload);
        logger.info(MODULE_AGENT, `Published ${TOPIC_REVISION_NEEDED}`, timer.elapsed(timerKey));
      } else {
        const validatedPayload: TaskValidatedPayload = {
          questId,
          taskId,
          score: result.score,
          severity: result.severity,
          feedback: result.feedback,
        };
        await client.publish(TOPIC_VALIDATED, validatedPayload);
        logger.info(MODULE_AGENT, `Published ${TOPIC_VALIDATED}`, timer.elapsed(timerKey));
      }
    } catch (err: any) {
      logger.error(MODULE_AGENT, `Validation handler error: ${err.message}`, timer.elapsed(timerKey));
    }
  });

  logger.info(MODULE_AGENT, `Subscribed to ${TOPIC_REVIEW_REQUESTED}`, timer.elapsed('main'));
}
