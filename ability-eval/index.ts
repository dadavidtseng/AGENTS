/**
 * ability-eval — Stateless Evaluation Engine
 *
 * Analyzes code diffs, test results, logs, and behavior traces.
 * Produces structured scores, pass/fail verdicts, and improvement suggestions.
 * Routes all LLM calls through the model-manager gateway.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { KadiClient, z } from '@kadi.build/core';
import { readConfig } from 'agents-library';
import type { Config } from 'agents-library';

// ============================================================================
// Vault Credential Loading
// ============================================================================

/** Load model-manager credentials from vault via loadNative (graceful degradation) */
async function loadVaultCredentials(): Promise<{ baseUrl?: string; apiKey?: string }> {
  try {
    const tmpClient = new KadiClient({ name: 'vault-loader', version: '1.0.0' });
    const secrets = await tmpClient.loadNative('secret-ability');
    const urlResult: any = await secrets.invoke('get', {
      vault: 'model-manager', key: 'MODEL_MANAGER_BASE_URL',
    }).catch(() => null);
    const keyResult: any = await secrets.invoke('get', {
      vault: 'model-manager', key: 'MODEL_MANAGER_API_KEY',
    }).catch(() => null);
    await secrets.disconnect();
    const loaded = [urlResult?.value, keyResult?.value].filter(Boolean).length;
    if (loaded > 0) console.log(`[vault] Loaded ${loaded}/2 credentials from "model-manager" vault`);
    return {
      baseUrl: urlResult?.value ?? undefined,
      apiKey: keyResult?.value ?? undefined,
    };
  } catch {
    return {};
  }
}

// ============================================================================
// Configuration — Priority: env var > config.toml > default
// ============================================================================

let cfg: Config | null = null;
try {
  cfg = readConfig();
} catch {
  // config.toml not found — use defaults
}

const _vault = await loadVaultCredentials();
const MODEL_MANAGER_BASE_URL = (
  process.env.MODEL_MANAGER_BASE_URL || _vault.baseUrl || 'http://localhost:3000'
).replace(/\/$/, '');
const MODEL_MANAGER_API_KEY = process.env.MODEL_MANAGER_API_KEY || _vault.apiKey || '';
const EVAL_MODEL = process.env.EVAL_MODEL
  || (cfg?.has('model.EVAL_MODEL') ? cfg.string('model.EVAL_MODEL') : null)
  || 'gpt-5-mini';
const MAX_TOKENS = parseInt(
  process.env.EVAL_MAX_TOKENS
  || (cfg?.has('model.MAX_TOKENS') ? String(cfg.number('model.MAX_TOKENS')) : '')
  || '4096', 10);
const TIMEOUT_MS = parseInt(process.env.EVAL_TIMEOUT_MS || '120000', 10);

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ============================================================================
// KadiClient
// ============================================================================

const brokerConfig: { url: string; networks?: string[] } = {
  url: process.env.KADI_BROKER_URL || 'ws://localhost:8080/kadi',
};
if (process.env.KADI_NETWORK) {
  brokerConfig.networks = [process.env.KADI_NETWORK];
}

const client = new KadiClient({
  name: 'ability-eval',
  brokers: { default: brokerConfig },
});

// ============================================================================
// Model Manager API
// ============================================================================

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

async function callLLM(messages: ChatMessage[], model?: string): Promise<string> {
  if (!MODEL_MANAGER_API_KEY) {
    throw new Error('MODEL_MANAGER_API_KEY is not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${MODEL_MANAGER_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MODEL_MANAGER_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || EVAL_MODEL,
        messages,
        max_completion_tokens: MAX_TOKENS,
        stream: false,
      }),
      signal: controller.signal,
      // @ts-ignore — Node fetch accepts agent
      agent: httpsAgent,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Model manager returned ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (content === null || content === undefined) {
      throw new Error('No content in model manager response');
    }
    return content;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Eval request timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

/** Parse JSON from LLM response, stripping markdown fences if present */
function parseJsonResponse(raw: string): any {
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  return JSON.parse(cleaned);
}

/** Read a file if it exists, return content or null */
function readFileIfExists(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved, 'utf-8');
}

/**
 * Convert an image source to an OpenAI vision content block.
 * Accepts: file path, URL (http/https), data URI, or raw base64.
 */
function imageToContentBlock(source: string, detail: 'low' | 'high' | 'auto' = 'high'): ContentBlock {
  // Already a data URI
  if (source.startsWith('data:image/')) {
    return { type: 'image_url', image_url: { url: source, detail } };
  }
  // Remote URL
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return { type: 'image_url', image_url: { url: source, detail } };
  }
  // Local file path — read and base64 encode
  const resolved = path.resolve(source);
  if (fs.existsSync(resolved)) {
    const buffer = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`;
    const b64 = buffer.toString('base64');
    return { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail } };
  }
  // Assume raw base64
  return { type: 'image_url', image_url: { url: `data:image/png;base64,${source}`, detail } };
}

// ============================================================================
// Evaluation Tools
// ============================================================================

const EVAL_RESPONSE_FORMAT = `Respond in JSON with this structure:
{
  "verdict": "pass" | "fail" | "needs_improvement",
  "score": <number 0-100>,
  "criteria": { "<criterion>": { "score": <0-100>, "notes": "<detail>" } },
  "summary": "<1-2 sentence overall assessment>",
  "suggestions": ["<improvement 1>", "<improvement 2>", ...]
}`;

client.registerTool({
  name: 'eval_code_diff',
  description: 'Evaluate a code diff for quality, correctness, and adherence to best practices',
  input: z.object({
    diff: z.string().describe('Git diff or unified diff content'),
    context: z.string().optional().describe('Additional context about the change (PR description, task requirements)'),
    criteria: z.string().optional().describe('Comma-separated evaluation criteria (default: correctness,quality,security,readability)'),
    model: z.string().optional().describe('Override evaluation model'),
  }),
}, async (params) => {
  const criteria = params.criteria || 'correctness,quality,security,readability';
  const contextBlock = params.context ? `\n\nContext:\n${params.context}` : '';
  const result = await callLLM([
    {
      role: 'system',
      content: `You are a senior code reviewer. Evaluate the following code diff on these criteria: ${criteria}.\n\n${EVAL_RESPONSE_FORMAT}`,
    },
    {
      role: 'user',
      content: `Code diff:\n\`\`\`diff\n${params.diff}\n\`\`\`${contextBlock}`,
    },
  ], params.model);
  return parseJsonResponse(result);
});

client.registerTool({
  name: 'eval_test_results',
  description: 'Evaluate test results — analyze failures, coverage gaps, flaky patterns',
  input: z.object({
    results: z.string().describe('Test output (stdout/stderr from test runner)'),
    test_framework: z.string().optional().describe('Test framework (jest, pytest, vitest, etc.)'),
    context: z.string().optional().describe('What was being tested and why'),
    model: z.string().optional().describe('Override evaluation model'),
  }),
}, async (params) => {
  const fw = params.test_framework ? ` (${params.test_framework})` : '';
  const contextBlock = params.context ? `\n\nContext:\n${params.context}` : '';
  const result = await callLLM([
    {
      role: 'system',
      content: `You are a test analysis expert. Evaluate these test results${fw}. Identify failures, coverage gaps, flaky patterns, and reliability concerns.\n\n${EVAL_RESPONSE_FORMAT}`,
    },
    {
      role: 'user',
      content: `Test output:\n\`\`\`\n${params.results}\n\`\`\`${contextBlock}`,
    },
  ], params.model);
  return parseJsonResponse(result);
});

client.registerTool({
  name: 'eval_logs',
  description: 'Evaluate application logs — detect errors, anomalies, performance issues',
  input: z.object({
    logs: z.string().describe('Log content (or file path to read)'),
    focus: z.string().optional().describe('What to look for (errors, performance, security, etc.)'),
    model: z.string().optional().describe('Override evaluation model'),
  }),
}, async (params) => {
  let logContent = params.logs;
  if (!logContent.includes('\n') && logContent.length < 500) {
    const fileContent = readFileIfExists(logContent);
    if (fileContent) logContent = fileContent;
  }
  const focusHint = params.focus ? ` Focus on: ${params.focus}.` : '';
  const result = await callLLM([
    {
      role: 'system',
      content: `You are a log analysis expert. Analyze these logs for errors, anomalies, performance issues, and concerning patterns.${focusHint}\n\n${EVAL_RESPONSE_FORMAT}`,
    },
    { role: 'user', content: `Logs:\n\`\`\`\n${logContent}\n\`\`\`` },
  ], params.model);
  return parseJsonResponse(result);
});

client.registerTool({
  name: 'eval_behavior_trace',
  description: 'Evaluate an agent behavior trace — decision quality, tool usage, efficiency',
  input: z.object({
    trace: z.string().describe('Agent behavior trace (actions, decisions, tool calls)'),
    task_description: z.string().describe('What the agent was supposed to accomplish'),
    criteria: z.string().optional().describe('Comma-separated criteria (default: goal_alignment,efficiency,tool_usage,reasoning)'),
    model: z.string().optional().describe('Override evaluation model'),
  }),
}, async (params) => {
  const criteria = params.criteria || 'goal_alignment,efficiency,tool_usage,reasoning';
  const result = await callLLM([
    {
      role: 'system',
      content: `You are an AI agent evaluator. Analyze this behavior trace against the stated task. Evaluate on: ${criteria}.\n\n${EVAL_RESPONSE_FORMAT}`,
    },
    {
      role: 'user',
      content: `Task: ${params.task_description}\n\nBehavior trace:\n\`\`\`\n${params.trace}\n\`\`\``,
    },
  ], params.model);
  return parseJsonResponse(result);
});

client.registerTool({
  name: 'eval_task_completion',
  description: 'Evaluate whether a task was completed successfully against its requirements',
  input: z.object({
    task_requirements: z.string().describe('Original task requirements or acceptance criteria'),
    deliverables: z.string().describe('What was actually delivered (description, file list, output)'),
    evidence: z.string().optional().describe('Supporting evidence (test results, screenshots, logs)'),
    model: z.string().optional().describe('Override evaluation model'),
  }),
}, async (params) => {
  const evidenceBlock = params.evidence ? `\n\nEvidence:\n${params.evidence}` : '';
  const result = await callLLM([
    {
      role: 'system',
      content: `You are a QA evaluator. Determine if the deliverables satisfy the task requirements. Check each requirement individually.\n\n${EVAL_RESPONSE_FORMAT}`,
    },
    {
      role: 'user',
      content: `Requirements:\n${params.task_requirements}\n\nDeliverables:\n${params.deliverables}${evidenceBlock}`,
    },
  ], params.model);
  return parseJsonResponse(result);
});

client.registerTool({
  name: 'eval_custom',
  description: 'Run a custom evaluation with user-defined criteria and rubric',
  input: z.object({
    content: z.string().describe('Content to evaluate'),
    rubric: z.string().describe('Evaluation rubric or criteria description'),
    model: z.string().optional().describe('Override evaluation model'),
  }),
}, async (params) => {
  const result = await callLLM([
    {
      role: 'system',
      content: `You are an evaluation specialist. Evaluate the provided content using the given rubric.\n\n${EVAL_RESPONSE_FORMAT}`,
    },
    {
      role: 'user',
      content: `Rubric:\n${params.rubric}\n\nContent to evaluate:\n${params.content}`,
    },
  ], params.model);
  return parseJsonResponse(result);
});

client.registerTool({
  name: 'eval_compare',
  description: 'Compare two solutions/approaches and determine which is better',
  input: z.object({
    solution_a: z.string().describe('First solution or approach'),
    solution_b: z.string().describe('Second solution or approach'),
    criteria: z.string().optional().describe('Comparison criteria (default: correctness,elegance,maintainability,performance)'),
    context: z.string().optional().describe('Context about what problem is being solved'),
    model: z.string().optional().describe('Override evaluation model'),
  }),
}, async (params) => {
  const criteria = params.criteria || 'correctness,elegance,maintainability,performance';
  const contextBlock = params.context ? `\nContext: ${params.context}` : '';
  const result = await callLLM([
    {
      role: 'system',
      content: `You are a technical evaluator. Compare two solutions on: ${criteria}. Respond in JSON:
{
  "winner": "A" | "B" | "tie",
  "score_a": <0-100>,
  "score_b": <0-100>,
  "criteria": { "<criterion>": { "score_a": <0-100>, "score_b": <0-100>, "notes": "<detail>" } },
  "summary": "<1-2 sentence comparison>",
  "recommendation": "<which to use and why>"
}`,
    },
    {
      role: 'user',
      content: `${contextBlock}\n\nSolution A:\n${params.solution_a}\n\nSolution B:\n${params.solution_b}`,
    },
  ], params.model);
  return parseJsonResponse(result);
});

// ============================================================================
// Visual Evaluation Tools (uses ability-vision pattern — multimodal LLM)
// ============================================================================

const VISUAL_EVAL_FORMAT = `Respond in JSON with this structure:
{
  "verdict": "pass" | "fail" | "needs_improvement",
  "score": <number 0-100>,
  "criteria": {
    "layout": { "score": <0-100>, "notes": "<detail>" },
    "visual_correctness": { "score": <0-100>, "notes": "<detail>" },
    "text_readability": { "score": <0-100>, "notes": "<detail>" },
    "accessibility_contrast": { "score": <0-100>, "notes": "<detail>" }
  },
  "summary": "<1-2 sentence overall assessment>",
  "issues": ["<issue 1>", "<issue 2>", ...],
  "suggestions": ["<improvement 1>", "<improvement 2>", ...]
}`;

client.registerTool({
  name: 'eval_visual',
  description: 'Evaluate a UI screenshot against requirements — layout, readability, accessibility',
  input: z.object({
    image: z.string().describe('Screenshot: file path, URL, data URI, or base64'),
    requirements: z.string().describe('UI requirements or design spec to evaluate against'),
    criteria: z.string().optional().describe('Comma-separated criteria (default: layout,visual_correctness,text_readability,accessibility_contrast)'),
    model: z.string().optional().describe('Override evaluation model (must support vision)'),
  }),
}, async (params) => {
  const criteria = params.criteria || 'layout,visual_correctness,text_readability,accessibility_contrast';
  const result = await callLLM([
    {
      role: 'system',
      content: `You are a UI/UX QA evaluator with expertise in visual verification. Evaluate the screenshot against the given requirements on these criteria: ${criteria}.\n\n${VISUAL_EVAL_FORMAT}`,
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Requirements:\n${params.requirements}\n\nEvaluate this screenshot:` },
        imageToContentBlock(params.image),
      ],
    },
  ], params.model);
  return parseJsonResponse(result);
});

client.registerTool({
  name: 'eval_visual_regression',
  description: 'Compare before/after screenshots to detect visual regressions',
  input: z.object({
    before: z.string().describe('Before screenshot: file path, URL, data URI, or base64'),
    after: z.string().describe('After screenshot: file path, URL, data URI, or base64'),
    context: z.string().optional().describe('What changed between the two screenshots'),
    threshold: z.number().optional().describe('Minimum score (0-100) to pass (default: 80)'),
    model: z.string().optional().describe('Override evaluation model (must support vision)'),
  }),
}, async (params) => {
  const threshold = params.threshold ?? 80;
  const contextBlock = params.context ? `\nExpected changes: ${params.context}` : '';
  const result = await callLLM([
    {
      role: 'system',
      content: `You are a visual regression testing expert. Compare the BEFORE and AFTER screenshots. Identify unintended visual changes (regressions) while allowing expected changes.${contextBlock}

Respond in JSON:
{
  "verdict": "pass" | "fail",
  "score": <0-100, where 100 = no regressions>,
  "regressions": [{ "area": "<location>", "severity": "critical" | "major" | "minor", "description": "<what changed>" }],
  "expected_changes": ["<change that matches context>"],
  "summary": "<1-2 sentence assessment>"
}

Score >= ${threshold} = pass, below = fail.`,
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'BEFORE screenshot:' },
        imageToContentBlock(params.before),
        { type: 'text', text: 'AFTER screenshot:' },
        imageToContentBlock(params.after),
      ],
    },
  ], params.model);
  return parseJsonResponse(result);
});

// ============================================================================
// Startup
// ============================================================================

export default client;

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const mode = (process.env.KADI_MODE || process.argv[2] || 'stdio') as 'stdio' | 'broker';

  console.log(`[ability-eval] Model: ${EVAL_MODEL} via model-manager`);
  console.log(`[ability-eval] Starting in ${mode} mode...`);

  client.serve(mode);
}
