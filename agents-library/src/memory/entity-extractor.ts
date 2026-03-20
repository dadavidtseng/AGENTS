/**
 * Entity Extractor — LLM-based Entity Extraction for Task Memories
 *
 * Identifies topics, tools, patterns, and technologies from task context
 * and outcomes using LLM-based extraction. Generates embedding vectors
 * for semantic search.
 *
 * Design:
 * - Uses ProviderManager for LLM calls (consistent with codebase)
 * - Graceful degradation: returns empty results on LLM failure
 * - Token-efficient: focused extraction prompt, JSON output
 */

import type { Result } from '../common/result.js';
import { ok, err } from '../common/result.js';
import type { ProviderManager } from '../providers/provider-manager.js';
import type { ExtractedEntity } from './memory-service.js';

/**
 * Entity extraction input context
 */
export interface ExtractionContext {
  taskId: string;
  taskType: string;
  description: string;
  context: string;
  result: string;
  outcome: 'success' | 'failure';
  agentRole: string;
}

/**
 * Entity extraction result with optional embeddings
 */
export interface ExtractionResult {
  entities: ExtractedEntity[];
  embedding: number[] | null;
  summary: string;
}

/**
 * Entity extraction error
 */
export interface ExtractionError {
  type: 'LLM_ERROR' | 'PARSE_ERROR' | 'VALIDATION_ERROR';
  message: string;
  originalError?: unknown;
}

/**
 * System prompt for entity extraction — kept focused and token-efficient
 */
const EXTRACTION_PROMPT = `You are an entity extractor for an AI agent memory system.
Given a task context and outcome, extract structured entities.

Return ONLY valid JSON (no markdown, no explanation) in this format:
{
  "entities": [
    {"name": "entity name", "type": "topic|tool|pattern|technology|agent|error", "confidence": 0.0-1.0}
  ],
  "summary": "One sentence summary of the task and its outcome"
}

Entity types:
- topic: Domain concepts, features, or areas (e.g., "authentication", "file upload")
- tool: Specific tools, APIs, or commands used (e.g., "git worktree", "file_read")
- pattern: Design patterns, approaches, or strategies (e.g., "retry with backoff", "event-driven")
- technology: Languages, frameworks, or libraries (e.g., "TypeScript", "ArcadeDB")
- agent: Agent names or roles involved (e.g., "agent-worker", "programmer")
- error: Error types or failure modes encountered (e.g., "timeout", "permission denied")

Rules:
- Extract 3-10 entities per task (more for complex tasks)
- Set confidence based on how explicitly the entity appears (1.0 = explicitly named, 0.5 = implied)
- Include the outcome context (what worked or failed)
- Keep entity names lowercase and concise`;

/**
 * System prompt for generating embedding text
 */
const EMBEDDING_PROMPT = `You are generating a semantic search key for an AI agent memory system.
Given a task description and extracted entities, produce a dense text representation
suitable for semantic matching. Return ONLY the text (no JSON, no explanation).
Keep it under 200 words. Include: task type, key entities, outcome, and lessons learned.`;

/**
 * Entity Extractor
 *
 * Extracts structured entities and generates embeddings from task memories
 * using LLM-based analysis via ProviderManager.
 */
export class EntityExtractor {
  constructor(private readonly providerManager: ProviderManager) {}

  /**
   * Extract entities from a task context
   *
   * Calls LLM to identify topics, tools, patterns, and technologies.
   * Returns empty entities array on LLM failure (graceful degradation).
   *
   * @param context - Task context for extraction
   * @returns Result with extraction result or error
   */
  async extractEntities(
    context: ExtractionContext
  ): Promise<Result<ExtractionResult, ExtractionError>> {
    // Build the user message with task context
    const userMessage = this.buildExtractionMessage(context);

    // Call LLM for entity extraction
    const llmResult = await this.providerManager.chat(
      [{ role: 'user', content: userMessage }],
      {
        system: EXTRACTION_PROMPT,
        maxTokens: 1024,
        temperature: 0.1, // Low temperature for structured output
      }
    );

    if (!llmResult.success) {
      console.warn(
        `[EntityExtractor] LLM extraction failed for task ${context.taskId}: ${llmResult.error.message}`
      );
      // Graceful degradation: return empty entities
      return ok({
        entities: [],
        embedding: null,
        summary: `${context.outcome}: ${context.description}`,
      });
    }

    // Parse the JSON response
    const parseResult = this.parseExtractionResponse(llmResult.data);

    if (!parseResult.success) {
      console.warn(
        `[EntityExtractor] Failed to parse LLM response for task ${context.taskId}: ${parseResult.error.message}`
      );
      // Graceful degradation: return empty entities
      return ok({
        entities: [],
        embedding: null,
        summary: `${context.outcome}: ${context.description}`,
      });
    }

    const { entities, summary } = parseResult.data;

    // Generate embedding text (non-blocking, optional)
    const embedding = await this.generateEmbedding(context, entities, summary);

    return ok({
      entities,
      embedding,
      summary,
    });
  }

  /**
   * Extract entities with graceful fallback
   *
   * Convenience method that always returns entities (empty on failure).
   * Use this in fire-and-forget contexts where extraction errors should
   * not propagate.
   *
   * @param context - Task context for extraction
   * @returns Extracted entities (empty array on any failure)
   */
  async extractEntitiesOrEmpty(context: ExtractionContext): Promise<ExtractedEntity[]> {
    const result = await this.extractEntities(context);

    if (!result.success) {
      return [];
    }

    return result.data.entities;
  }

  /**
   * Build the user message for entity extraction
   */
  private buildExtractionMessage(context: ExtractionContext): string {
    const parts: string[] = [
      `Task ID: ${context.taskId}`,
      `Task Type: ${context.taskType}`,
      `Agent Role: ${context.agentRole}`,
      `Outcome: ${context.outcome}`,
      `Description: ${context.description}`,
    ];

    if (context.context) {
      // Truncate context to keep token usage manageable
      const truncated = context.context.length > 2000
        ? context.context.slice(0, 2000) + '...[truncated]'
        : context.context;
      parts.push(`Context: ${truncated}`);
    }

    if (context.result) {
      const truncated = context.result.length > 1000
        ? context.result.slice(0, 1000) + '...[truncated]'
        : context.result;
      parts.push(`Result: ${truncated}`);
    }

    return parts.join('\n');
  }

  /**
   * Parse the LLM JSON response into entities and summary
   */
  private parseExtractionResponse(
    response: string
  ): Result<{ entities: ExtractedEntity[]; summary: string }, ExtractionError> {
    try {
      // Strip markdown code fences if present
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(cleaned);

      // Validate structure
      if (!parsed.entities || !Array.isArray(parsed.entities)) {
        return err({
          type: 'PARSE_ERROR',
          message: 'Response missing "entities" array',
        });
      }

      // Validate and normalize entities
      const validTypes = new Set(['topic', 'tool', 'pattern', 'technology', 'agent', 'error']);
      const entities: ExtractedEntity[] = parsed.entities
        .filter((e: any) => e.name && e.type && validTypes.has(e.type))
        .map((e: any) => ({
          name: String(e.name).toLowerCase().trim(),
          type: e.type as ExtractedEntity['type'],
          confidence: Math.max(0, Math.min(1, Number(e.confidence) || 0.5)),
        }));

      const summary = parsed.summary
        ? String(parsed.summary)
        : 'No summary provided';

      return ok({ entities, summary });
    } catch (error: any) {
      return err({
        type: 'PARSE_ERROR',
        message: `JSON parse failed: ${error.message}`,
        originalError: error,
      });
    }
  }

  /**
   * Generate a semantic embedding text for the task
   *
   * Uses LLM to create a dense text representation suitable for
   * semantic search. Returns null on failure.
   *
   * Note: This generates embedding *text*, not vectors. The actual
   * vector embedding can be generated by a dedicated embedding model
   * (e.g., in ability-memory-search) using this text as input.
   *
   * @param context - Original task context
   * @param entities - Extracted entities
   * @param summary - Task summary
   * @returns Numeric embedding or null on failure
   */
  private async generateEmbedding(
    context: ExtractionContext,
    entities: ExtractedEntity[],
    summary: string
  ): Promise<number[] | null> {
    // Generate embedding text via LLM
    const entityNames = entities.map(e => `${e.type}:${e.name}`).join(', ');
    const userMessage = [
      `Task Type: ${context.taskType}`,
      `Summary: ${summary}`,
      `Entities: ${entityNames}`,
      `Outcome: ${context.outcome}`,
    ].join('\n');

    const llmResult = await this.providerManager.chat(
      [{ role: 'user', content: userMessage }],
      {
        system: EMBEDDING_PROMPT,
        maxTokens: 512,
        temperature: 0.0,
      }
    );

    if (!llmResult.success) {
      console.warn(
        `[EntityExtractor] Embedding generation failed for task ${context.taskId}: ${llmResult.error.message}`
      );
      return null;
    }

    // Convert text to simple hash-based embedding vector
    // This provides basic semantic grouping until a dedicated embedding model is available
    return this.textToEmbedding(llmResult.data);
  }

  /**
   * Convert text to a simple numeric embedding vector
   *
   * Uses character-level hashing to produce a fixed-size vector.
   * This is a lightweight fallback — real embeddings should come from
   * a dedicated embedding model (e.g., via ability-memory-search).
   *
   * @param text - Text to embed
   * @returns Fixed-size numeric vector (128 dimensions)
   */
  private textToEmbedding(text: string): number[] {
    const dimensions = 128;
    const embedding = new Array<number>(dimensions).fill(0);

    // Simple bag-of-words hashing into fixed dimensions
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
      }
      const index = Math.abs(hash) % dimensions;
      embedding[index] += 1;
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dimensions; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }
}
