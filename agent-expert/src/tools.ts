/**
 * Tool helpers — searching docs, broker discovery, LLM synthesis, TDD generation.
 *
 * Adapted from kadi-expert for the AGENTS ecosystem.
 */

import type { KadiClient } from '@kadi.build/core';
import { SYSTEM_ASK, SYSTEM_EXAMPLE, SYSTEM_EXPLAIN, SYSTEM_GUIDE, SYSTEM_TDD } from './prompts/index.js';

// ── Configuration ─────────────────────────────────────────────────────

export const DEFAULT_MODEL = 'claude-sonnet-4-5';
const MAX_SYNTHESIS_TOKENS = 4096;
const MAX_TDD_TOKENS = 8192;

export const FEATURED_MODELS = [
  { id: 'claude-sonnet-4-5',  label: 'Claude Sonnet 4.5',  tier: 'flagship' },
  { id: 'gpt-5',              label: 'GPT-5',              tier: 'flagship' },
  { id: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5',   tier: 'fast' },
  { id: 'gpt-5-mini',         label: 'GPT-5 Mini',         tier: 'fast' },
] as const;

// ── Types ─────────────────────────────────────────────────────────────

export interface DocChunk {
  content: string;
  source: string;
  score: number;
  title?: string;
  slug?: string;
  pageUrl?: string;
  importance?: number;
  matchedVia?: string[];
}

interface ChatCompletionResult {
  choices: Array<{ message: { content: string | null } }>;
}

// ── Core helpers ──────────────────────────────────────────────────────

export async function searchDocs(
  client: KadiClient,
  query: string,
  mode = 'hybrid',
  limit = 8,
): Promise<DocChunk[]> {
  try {
    const result = await client.invokeRemote<{ results: DocChunk[] }>('docs-search', {
      query, mode, limit, collection: 'agents-docs',
    });
    return result?.results ?? [];
  } catch (err) {
    console.error('[searchDocs]', (err as Error).message);
    return [];
  }
}

export async function discoverTool(client: KadiClient, toolName: string): Promise<any> {
  try {
    return await client.invokeRemote('kadi.discover', { tool: toolName, includeProviders: true });
  } catch {
    return null;
  }
}

async function synthesize(
  client: KadiClient,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string | undefined,
  model = DEFAULT_MODEL,
  maxTokens = MAX_SYNTHESIS_TOKENS,
): Promise<string> {
  if (!apiKey) return userPrompt;

  try {
    const result = await client.invokeRemote<ChatCompletionResult>('chat-completion', {
      api_key: apiKey,
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.25,
      max_tokens: maxTokens,
    });
    return result?.choices?.[0]?.message?.content ?? userPrompt;
  } catch (err) {
    console.error('[synthesize]', (err as Error).message);
    return userPrompt;
  }
}

function dedupeChunks(chunks: DocChunk[]): DocChunk[] {
  const seen = new Set<string>();
  return chunks.filter((c) => {
    const key = c.content.slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildContext(chunks: DocChunk[], max = 8): string {
  return chunks.slice(0, max)
    .map((c, i) => `--- Source ${i + 1}: ${c.source} (score: ${c.score.toFixed(3)}) ---\n${c.content.trim()}`)
    .join('\n\n');
}

// ── Format functions ──────────────────────────────────────────────────

export async function formatAnswer(
  client: KadiClient, question: string, results: DocChunk[],
  apiKey: string | undefined, model = DEFAULT_MODEL,
) {
  const unique = dedupeChunks(results);
  if (unique.length === 0) return { answer: "No relevant documentation found.", sources: [] };
  const answer = await synthesize(client, SYSTEM_ASK, `Question: ${question}\n\n${buildContext(unique)}`, apiKey, model);
  return { answer, sources: unique.map(c => ({ source: c.source, score: c.score })) };
}

export async function formatExample(
  client: KadiClient, topic: string, results: DocChunk[],
  apiKey: string | undefined, model = DEFAULT_MODEL,
) {
  const unique = dedupeChunks(results);
  if (unique.length === 0) return { answer: `No examples found for "${topic}".`, sources: [] };
  const answer = await synthesize(client, SYSTEM_EXAMPLE, `Topic: ${topic}\n\n${buildContext(unique)}`, apiKey, model);
  return { answer, sources: unique.map(c => ({ source: c.source, score: c.score })) };
}

export async function formatToolReport(
  client: KadiClient, toolName: string, discovery: any, docs: DocChunk[],
  apiKey: string | undefined, model = DEFAULT_MODEL,
) {
  const unique = dedupeChunks(docs);
  const toolInfo = discovery?.tools?.[0];
  let discoveryBlock = toolInfo
    ? `Tool: ${toolName}\nDescription: ${toolInfo.description}\nProviders: ${toolInfo.providerCount}\nSchema:\n\`\`\`json\n${JSON.stringify(toolInfo.inputSchema, null, 2)}\n\`\`\``
    : `Tool "${toolName}" not found via discovery.`;
  const answer = await synthesize(client, SYSTEM_EXPLAIN, `${discoveryBlock}\n\n${buildContext(unique, 5)}`, apiKey, model);
  return {
    answer,
    schema: toolInfo?.inputSchema ?? null,
    providers: toolInfo?.providers?.map((p: any) => ({ displayName: p.displayName, source: p.source })) ?? [],
    sources: unique.map(c => ({ source: c.source, score: c.score })),
  };
}

export async function formatGuide(
  client: KadiClient, goal: string, results: DocChunk[],
  apiKey: string | undefined, model = DEFAULT_MODEL,
) {
  const unique = dedupeChunks(results);
  if (unique.length === 0) return { answer: `No documentation found for "${goal}".`, sources: [] };
  const answer = await synthesize(client, SYSTEM_GUIDE, `Goal: ${goal}\n\n${buildContext(unique, 12)}`, apiKey, model);
  return { answer, sources: unique.map(c => ({ source: c.source, score: c.score })) };
}

export async function formatTdd(
  client: KadiClient, feature: string, scope: string | undefined, results: DocChunk[],
  apiKey: string | undefined, model = DEFAULT_MODEL,
) {
  const unique = dedupeChunks(results);
  const scopeNote = scope ? `\nScope: ${scope}` : '';
  const userPrompt = `Feature: ${feature}${scopeNote}\n\nRetrieved architecture and documentation (${unique.length} sections):\n\n${buildContext(unique, 12)}`;
  const tdd = await synthesize(client, SYSTEM_TDD, userPrompt, apiKey, model, MAX_TDD_TOKENS);
  return { tdd, sources: unique.map(c => ({ source: c.source, score: c.score })) };
}

// ── Register broker tools ─────────────────────────────────────────────

export function registerTools(client: any, secretCache: Record<string, string>): void {
  const apiKey = () => secretCache['MM-1_API_KEY'] ?? secretCache['MEMORY_API_KEY'];

  client.registerTool(
    { name: 'ask-agents', description: 'Answer questions about the AGENTS ecosystem by searching docs and synthesizing with LLM.', input: { type: 'object', properties: { question: { type: 'string' }, model: { type: 'string' } }, required: ['question'] } },
    async (input: any) => formatAnswer(client, input.question, await searchDocs(client, input.question), apiKey(), input.model),
  );

  client.registerTool(
    { name: 'show-example', description: 'Find and present code examples for an AGENTS topic.', input: { type: 'object', properties: { topic: { type: 'string' }, model: { type: 'string' } }, required: ['topic'] } },
    async (input: any) => formatExample(client, input.topic, await searchDocs(client, `${input.topic} code example`), apiKey(), input.model),
  );

  client.registerTool(
    { name: 'explain-agent', description: 'Look up an agent or ability and explain its tools, config, and usage.', input: { type: 'object', properties: { agent: { type: 'string' }, model: { type: 'string' } }, required: ['agent'] } },
    async (input: any) => {
      const [discovery, docs] = await Promise.all([
        discoverTool(client, input.agent),
        searchDocs(client, `${input.agent} tool usage`, 'hybrid', 5),
      ]);
      return formatToolReport(client, input.agent, discovery, docs, apiKey(), input.model);
    },
  );

  client.registerTool(
    { name: 'write-tdd', description: 'Generate a Technical Design Document for a feature. Searches AGENTS docs for context, then synthesizes a structured TDD.', input: { type: 'object', properties: { feature: { type: 'string' }, scope: { type: 'string' }, model: { type: 'string' } }, required: ['feature'] } },
    async (input: any) => {
      const queries = [
        searchDocs(client, `${input.feature} architecture`, 'hybrid', 6),
        searchDocs(client, `${input.feature} implementation`, 'hybrid', 6),
        input.scope ? searchDocs(client, `${input.scope} design`, 'hybrid', 4) : Promise.resolve([]),
      ];
      const [arch, impl, scope] = await Promise.all(queries);
      return formatTdd(client, input.feature, input.scope, [...arch, ...impl, ...scope], apiKey(), input.model);
    },
  );

  client.registerTool(
    { name: 'getting-started', description: 'Generate a step-by-step getting-started guide for an AGENTS development goal.', input: { type: 'object', properties: { goal: { type: 'string' }, model: { type: 'string' } }, required: ['goal'] } },
    async (input: any) => {
      const [tutorials, configs, examples] = await Promise.all([
        searchDocs(client, `tutorial ${input.goal}`, 'hybrid', 5),
        searchDocs(client, `${input.goal} configuration setup`, 'hybrid', 5),
        searchDocs(client, `${input.goal} example code`, 'hybrid', 5),
      ]);
      return formatGuide(client, input.goal, [...tutorials, ...configs, ...examples], apiKey(), input.model);
    },
  );

  console.log('[agent-expert] 5 broker tools registered');
}
