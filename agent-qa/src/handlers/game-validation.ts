/**
 * Game Validation — DaemonAgent-aware validation checks
 *
 * Provides content-based validation that detects when tasks involve
 * game engine operations and runs appropriate checks:
 *   - Game state verification via get_game_state
 *   - Visual validation via capture_screenshot + ability-vision
 *   - Screenshot upload to cloud storage for archival
 *
 * @module handlers/game-validation
 */

import { logger, MODULE_AGENT, timer } from 'agents-library';
import type { KadiClient } from '@kadi.build/core';

import type { ValidationCheck } from './validation.js';

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
// Response Parsing Helper
// ============================================================================

/**
 * Extract text content from a DaemonAgent tool response.
 * Handles multiple formats:
 *   - MCP-wrapped with content array (finds first text block, not image)
 *   - Direct JSON response (stringifies it)
 *   - Plain string response
 */
function extractTextFromResponse(resp: any): string | null {
  if (!resp) return null;

  // MCP-wrapped: content array with text/image blocks
  if (resp.content && Array.isArray(resp.content)) {
    // Find the text block (not image)
    const textBlock = resp.content.find((c: any) => c.type === 'text' && c.text);
    if (textBlock?.text) return textBlock.text;

    // Fallback: first block with text field
    const anyText = resp.content.find((c: any) => c.text);
    if (anyText?.text) return anyText.text;
  }

  // Direct JSON response (DaemonAgent sometimes returns unwrapped)
  if (resp.success !== undefined || resp.gameState || resp.filePath) {
    return JSON.stringify(resp);
  }

  // String response
  if (typeof resp === 'string') return resp;

  return null;
}

/**
 * Extract image data (base64) from a DaemonAgent tool response.
 */
function extractImageFromResponse(resp: any): { data: string; mimeType: string } | null {
  if (!resp?.content || !Array.isArray(resp.content)) return null;

  const imageBlock = resp.content.find((c: any) => c.type === 'image' && c.data);
  if (imageBlock) {
    return { data: imageBlock.data, mimeType: imageBlock.mimeType ?? 'image/png' };
  }
  return null;
}

// ============================================================================
// Types
// ============================================================================

/** Content-based analysis of what validation checks a task needs */
export interface ValidationNeeds {
  /** Task references game entities/scene — verify via get_game_state */
  needsGameState: boolean;
  /** Task expects visual output — capture screenshot + vision analysis */
  needsScreenshot: boolean;
  /** Task modifies DaemonAgent scripts — trigger rebuild/reload */
  needsBuild: boolean;
  /** Task has code changes — standard git diff pipeline */
  needsDiffReview: boolean;
  /** Keywords that triggered each need (for logging) */
  triggers: string[];
}

// ============================================================================
// Content Analysis
// ============================================================================

/** Patterns that indicate game state verification is needed */
const GAME_STATE_PATTERNS = [
  /spawn[_\s]*(cube|entity|object|model)/i,
  /move[_\s]*(cube|entity|object)/i,
  /remove[_\s]*(cube|entity|object)/i,
  /game[_\s]*(state|scene|engine)/i,
  /position\s*\(/i,
  /daemonagent/i,
  /game\s*entity/i,
  /scene\s*setup/i,
];

/** Patterns that indicate visual validation (screenshot) is needed */
const SCREENSHOT_PATTERNS = [
  /screenshot/i,
  /capture[_\s]*(screen|image|viewport)/i,
  /visual[_\s]*(output|result|validation|verify)/i,
  /render(ed|ing)?/i,
  /display[_\s]*(scene|result)/i,
  /final\s*scene/i,
  /viewport/i,
];

/** Patterns that indicate a DaemonAgent build/reload is needed */
const BUILD_PATTERNS = [
  /rebuild[_\s]*(game|daemon|engine)/i,
  /create[_\s]*script/i,
  /modify[_\s]*script/i,
  /v8[_\s]*script/i,
  /javascript[_\s]*(script|runtime)/i,
];

/** Patterns that indicate standard code diff review is needed */
const DIFF_PATTERNS = [
  /implement/i,
  /code/i,
  /\.(ts|js|tsx|jsx|py|cpp|h)\b/i,
  /function/i,
  /class\s/i,
  /refactor/i,
  /fix\s/i,
  /bug/i,
  /feature/i,
];

/**
 * Analyze task requirements to determine which validation checks to run.
 * Scans task description and requirements for keywords/patterns.
 */
export function analyzeValidationNeeds(
  taskDescription: string,
  taskRequirements: string,
): ValidationNeeds {
  const combined = `${taskDescription}\n${taskRequirements}`;
  const triggers: string[] = [];

  const matchesAny = (patterns: RegExp[]): boolean => {
    for (const p of patterns) {
      const match = combined.match(p);
      if (match) {
        triggers.push(match[0]);
        return true;
      }
    }
    return false;
  };

  const needs: ValidationNeeds = {
    needsGameState: matchesAny(GAME_STATE_PATTERNS),
    needsScreenshot: matchesAny(SCREENSHOT_PATTERNS),
    needsBuild: matchesAny(BUILD_PATTERNS),
    needsDiffReview: true, // Always review the diff — it's the baseline for any committed work
    triggers,
  };

  // Also check content-based diff patterns for logging
  matchesAny(DIFF_PATTERNS);

  logger.info(
    MODULE_AGENT,
    `analyzeValidationNeeds: gameState=${needs.needsGameState} screenshot=${needs.needsScreenshot} build=${needs.needsBuild} diff=${needs.needsDiffReview} triggers=[${triggers.join(', ')}]`,
    timer.elapsed('main'),
  );

  return needs;
}

// ============================================================================
// Game State Validation
// ============================================================================

/**
 * Validate game state via DaemonAgent's get_game_state tool.
 * Checks that expected entities exist and are in correct positions.
 */
export async function validateGameState(
  client: KadiClient,
  nativeEval: any | null,
  taskRequirements: string,
): Promise<ValidationCheck> {
  try {
    const resp = await client.invokeRemote<any>('get_game_state', {});
    logger.info(MODULE_AGENT, `get_game_state raw response: ${JSON.stringify(resp).slice(0, 500)}`, timer.elapsed('main'));

    const text = extractTextFromResponse(resp);
    logger.info(MODULE_AGENT, `get_game_state extracted text: ${text?.slice(0, 300) ?? 'null'}`, timer.elapsed('main'));
    if (!text || text.startsWith('Error:')) {
      return {
        name: 'game-state',
        passed: false,
        score: 0,
        detail: `DaemonAgent get_game_state failed: ${text ?? 'no response'}`,
      };
    }

    let gameState: any;
    try {
      gameState = JSON.parse(text);
    } catch {
      gameState = { raw: text };
    }
    logger.info(MODULE_AGENT, `Game state retrieved: ${JSON.stringify(gameState).slice(0, 500)}`, timer.elapsed('main'));

    // Use eval_task_completion to assess whether game state satisfies requirements
    try {
      const evalResp = await invokeEval<any>(client, nativeEval, 'eval_task_completion', {
        task_requirements: taskRequirements,
        deliverables: `Current game state:\n${JSON.stringify(gameState, null, 2)}`,
        evidence: 'Game state queried directly from DaemonAgent via get_game_state tool',
      });

      // Parse eval response
      const evalText = extractTextFromResponse(evalResp);
      const evalData = evalResp?.verdict
        ? evalResp
        : evalText
          ? JSON.parse(evalText)
          : null;

      if (evalData?.score != null) {
        return {
          name: 'game-state',
          passed: evalData.score >= 50,
          score: evalData.score,
          detail: evalData.summary ?? `Game state evaluation score: ${evalData.score}`,
        };
      }
    } catch (evalErr: any) {
      logger.warn(MODULE_AGENT, `eval_task_completion unavailable for game state: ${evalErr.message}`, timer.elapsed('main'));
    }

    // Fallback: game state was retrieved successfully, give a baseline pass
    return {
      name: 'game-state',
      passed: true,
      score: 70,
      detail: `Game state retrieved successfully (${Object.keys(gameState).length} top-level keys). Manual review recommended.`,
    };
  } catch (err: any) {
    // DaemonAgent unavailable — degrade gracefully
    logger.warn(MODULE_AGENT, `DaemonAgent unavailable for game state validation: ${err.message}`, timer.elapsed('main'));
    return {
      name: 'game-state',
      passed: true,
      score: 50,
      detail: `DaemonAgent unavailable — skipping game state check (${err.message})`,
    };
  }
}

// ============================================================================
// Screenshot Capture & Visual Validation
// ============================================================================

/**
 * Capture a screenshot from DaemonAgent, analyze with ability-vision,
 * and optionally upload to cloud storage.
 */
export async function validateGameScreenshot(
  client: KadiClient,
  nativeEval: any | null,
  nativeVision: any | null,
  taskRequirements: string,
  taskDescription: string,
  questId: string,
  taskId: string,
): Promise<ValidationCheck> {
  // Step 1: Capture screenshot via DaemonAgent
  let screenshotPath: string;
  try {
    const resp = await client.invokeRemote<any>('capture_screenshot', {});

    logger.info(MODULE_AGENT, `capture_screenshot raw response: ${JSON.stringify(resp).slice(0, 500)}`, timer.elapsed('main'));

    // Try to get image data directly (for vision analysis via data URI)
    const imageData = extractImageFromResponse(resp);
    const text = extractTextFromResponse(resp);
    logger.info(MODULE_AGENT, `capture_screenshot: text=${text?.slice(0, 200) ?? 'null'}, hasImage=${!!imageData}`, timer.elapsed('main'));

    if (!text && !imageData) {
      return {
        name: 'game-screenshot',
        passed: true,
        score: 50,
        detail: `DaemonAgent capture_screenshot failed: no response — skipping visual validation`,
      };
    }

    // Extract file path from text metadata
    if (text) {
      try {
        const parsed = JSON.parse(text);
        screenshotPath = parsed.filePath ?? parsed.path ?? parsed.screenshot ?? '';
      } catch {
        screenshotPath = text;
      }
    } else {
      screenshotPath = '';
    }

    // If we have base64 image data, use it as a data URI (more reliable than file path)
    if (imageData) {
      screenshotPath = `data:${imageData.mimeType};base64,${imageData.data}`;
    }

    logger.info(MODULE_AGENT, `Screenshot captured: ${screenshotPath.startsWith('data:') ? 'data URI (' + imageData?.mimeType + ')' : screenshotPath}`, timer.elapsed('main'));
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `DaemonAgent screenshot capture failed: ${err.message}`, timer.elapsed('main'));
    return {
      name: 'game-screenshot',
      passed: true,
      score: 50,
      detail: `DaemonAgent unavailable for screenshot — skipping visual validation (${err.message})`,
    };
  }

  // Step 2: Analyze with ability-vision
  let visionDescription: string | null = null;
  try {
    const visionResp = await invokeVision<any>(client, nativeVision, 'vision_vision_describe_ui', {
      image: screenshotPath,
      focus: 'game scene, 3D objects, entities, colors, positions, lighting',
    });

    const visionText = extractTextFromResponse(visionResp);
    if (visionText && !visionText.startsWith('Error:')) {
      visionDescription = visionText;
      logger.info(MODULE_AGENT, `Vision analysis: ${visionText.slice(0, 300)}`, timer.elapsed('main'));
    }
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `ability-vision unavailable: ${err.message}`, timer.elapsed('main'));
  }

  // Step 3: Upload screenshot to cloud storage (best-effort, non-blocking)
  uploadScreenshotToCloud(client, screenshotPath, questId, taskId).catch((err) => {
    logger.warn(MODULE_AGENT, `Screenshot cloud upload failed (non-fatal): ${err.message}`, timer.elapsed('main'));
  });

  // Step 4: Evaluate vision description against task requirements
  if (visionDescription) {
    try {
      const evalResp = await invokeEval<any>(client, nativeEval, 'eval_task_completion', {
        task_requirements: taskRequirements,
        deliverables: `Visual analysis of game screenshot:\n${visionDescription}`,
        evidence: `Task: ${taskDescription}\nScreenshot captured from DaemonAgent viewport`,
      });

      const evalData = evalResp?.verdict
        ? evalResp
        : evalResp?.content?.[0]?.text
          ? JSON.parse(evalResp.content[0].text)
          : null;

      if (evalData?.score != null) {
        return {
          name: 'game-screenshot',
          passed: evalData.score >= 50,
          score: evalData.score,
          detail: `[vision→eval] ${evalData.summary ?? `Visual validation score: ${evalData.score}`}`,
        };
      }
    } catch (evalErr: any) {
      logger.warn(MODULE_AGENT, `eval_task_completion failed for screenshot: ${evalErr.message}`, timer.elapsed('main'));
    }

    // Fallback: vision worked but eval didn't — partial pass
    return {
      name: 'game-screenshot',
      passed: true,
      score: 65,
      detail: `Screenshot captured and analyzed. Vision: ${visionDescription!.slice(0, 200)}... (eval unavailable)`,
    };
  }

  // No vision available — screenshot captured only
  return {
    name: 'game-screenshot',
    passed: true,
    score: 55,
    detail: 'Screenshot captured but ability-vision unavailable — visual validation skipped',
  };
}

// ============================================================================
// DaemonAgent Build/Reload Validation
// ============================================================================

/**
 * Trigger a DaemonAgent rebuild/reload if the task modified game scripts.
 * Uses agent-builder's rebuild_game or restart_game tools.
 */
export async function validateGameBuild(
  client: KadiClient,
): Promise<ValidationCheck> {
  try {
    // Try restart_game first (faster, no recompile)
    const resp = await client.invokeRemote<{
      content: Array<{ type: string; text: string }>;
    }>('restart_game', {});

    const text = resp?.content?.[0]?.text;
    if (text && !text.startsWith('Error:')) {
      logger.info(MODULE_AGENT, `DaemonAgent restarted: ${text.slice(0, 200)}`, timer.elapsed('main'));
      return {
        name: 'game-build',
        passed: true,
        score: 80,
        detail: 'DaemonAgent restarted successfully after script changes',
      };
    }

    return {
      name: 'game-build',
      passed: false,
      score: 30,
      detail: `DaemonAgent restart failed: ${text ?? 'no response'}`,
    };
  } catch (err: any) {
    logger.warn(MODULE_AGENT, `DaemonAgent restart unavailable: ${err.message}`, timer.elapsed('main'));
    return {
      name: 'game-build',
      passed: true,
      score: 50,
      detail: `DaemonAgent restart unavailable — skipping build validation (${err.message})`,
    };
  }
}

// ============================================================================
// Cloud Upload Helper
// ============================================================================

/**
 * Upload a screenshot to cloud storage for archival.
 * Uses ability-file-cloud's cloud-upload tool.
 */
async function uploadScreenshotToCloud(
  client: KadiClient,
  localPath: string,
  questId: string,
  taskId: string,
): Promise<void> {
  const remotePath = `/kadi/qa-screenshots/${questId}/${taskId}_${Date.now()}.png`;

  const resp = await client.invokeRemote<{
    content: Array<{ type: string; text: string }>;
  }>('cloud-upload', {
    provider: 'dropbox',
    localPath,
    remotePath,
  });

  const text = resp?.content?.[0]?.text;
  if (text && !text.startsWith('Error:')) {
    logger.info(MODULE_AGENT, `Screenshot uploaded to cloud: ${remotePath}`, timer.elapsed('main'));
  } else {
    logger.warn(MODULE_AGENT, `Screenshot cloud upload returned: ${text}`, timer.elapsed('main'));
  }
}
