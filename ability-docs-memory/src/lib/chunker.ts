/**
 * Markdown chunking — Splits documentation content by headings, enforces
 * max token limit, handles overlap between chunks.
 *
 * Ported from cli/kadi-docs/src/tools/graph-indexer.ts — the chunking logic.
 *
 * Strategy: markdown-headers
 *   1. Parse markdown into sections by headings
 *   2. Each section becomes a chunk (heading + body)
 *   3. If a section exceeds maxTokens, split at sentence boundaries
 *   4. Track breadcrumb heading paths for context
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A chunk of documentation content, ready for indexing. */
export interface DocChunk {
  /** The text content of this chunk. */
  content: string;
  /** Zero-based index of this chunk within its page. */
  chunkIndex: number;
  /** Total number of chunks in the source page. */
  totalChunks: number;
  /** Estimated token count. */
  tokens: number;
  /** Metadata about the chunking strategy. */
  metadata: {
    strategy: string;
    breadcrumb: string;
  };
}

/** Internal section representation during parsing. */
interface MarkdownSection {
  heading: string;
  level: number;
  lines: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum tokens per chunk. */
export const DEFAULT_MAX_TOKENS = 500;

/** Regex for opening/closing fenced code blocks. */
const FENCE_PATTERN = /^(`{3,}|~{3,})/;

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the number of tokens in a text string.
 * Uses the standard 1.3× word count heuristic.
 */
export function estimateTokens(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 1.3);
}

// ---------------------------------------------------------------------------
// Section parsing
// ---------------------------------------------------------------------------

/**
 * Parse a fenced code block opening/closing line.
 */
function parseFenceLine(
  line: string,
  inFencedBlock: boolean,
): { isFence: true; language: string } | { isFence: false } {
  const trimmed = line.trimStart();
  const match = trimmed.match(FENCE_PATTERN);
  if (!match) return { isFence: false };

  if (inFencedBlock) {
    if (trimmed.trimEnd() === match[1] || trimmed.trimEnd().match(/^(`{3,}|~{3,})\s*$/)) {
      return { isFence: true, language: '' };
    }
    return { isFence: false };
  }

  const afterFence = trimmed.slice(match[1].length).trim();
  const language = afterFence.split(/\s/)[0] || '';
  return { isFence: true, language };
}

/**
 * Split markdown content into sections by headings.
 * Tracks fenced code blocks to avoid splitting on headings inside code.
 */
export function splitIntoMarkdownSections(lines: string[]): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];
  let inFencedBlock = false;

  for (const line of lines) {
    const fence = parseFenceLine(line, inFencedBlock);
    if (fence.isFence) {
      inFencedBlock = !inFencedBlock;
      currentLines.push(line);
      continue;
    }

    if (inFencedBlock) {
      currentLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentLines.length > 0 || currentHeading) {
        sections.push({ heading: currentHeading, level: currentLevel, lines: currentLines });
      }
      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 || currentHeading) {
    sections.push({ heading: currentHeading, level: currentLevel, lines: currentLines });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Sentence boundary splitting
// ---------------------------------------------------------------------------

/**
 * Split text at a sentence boundary near the target token count.
 * Returns [firstPart, remainder].
 */
export function splitAtSentenceBoundary(
  text: string,
  maxTokens: number,
): [string, string] {
  const words = text.split(/\s+/);
  const targetWords = Math.floor(maxTokens / 1.3);
  if (targetWords >= words.length) return [text, ''];

  // Try to find a sentence boundary near the target
  const joined = words.slice(0, targetWords).join(' ');
  const sentenceEnd = Math.max(
    joined.lastIndexOf('. '),
    joined.lastIndexOf('.\n'),
    joined.lastIndexOf('? '),
    joined.lastIndexOf('! '),
  );

  if (sentenceEnd > joined.length * 0.5) {
    const first = text.substring(0, text.indexOf(joined.substring(sentenceEnd, sentenceEnd + 2)) + 2).trim();
    const second = text.substring(first.length).trim();
    return [first, second];
  }

  // Fall back to word boundary
  const firstPart = words.slice(0, targetWords).join(' ');
  const secondPart = words.slice(targetWords).join(' ');
  return [firstPart, secondPart];
}

/**
 * Recursively split text to fit within the token limit.
 */
export function splitToFitTokenLimit(text: string, maxTokens: number): string[] {
  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) return [text];

  const [first, rest] = splitAtSentenceBoundary(text, maxTokens);
  if (!rest) return [first];

  return [first, ...splitToFitTokenLimit(rest, maxTokens)];
}

// ---------------------------------------------------------------------------
// Main chunking function
// ---------------------------------------------------------------------------

/**
 * Chunk markdown content by headings with token limit enforcement.
 *
 * @param content   - Raw markdown content to chunk.
 * @param maxTokens - Maximum tokens per chunk (default: 500).
 * @returns Array of DocChunk objects with correct chunkIndex and totalChunks.
 */
export function chunkByMarkdownHeaders(
  content: string,
  maxTokens: number = DEFAULT_MAX_TOKENS,
): DocChunk[] {
  const lines = content.split('\n');
  const sections = splitIntoMarkdownSections(lines);

  if (sections.length === 0) return [];

  const headingStack: Array<{ heading: string; level: number }> = [];
  const chunks: DocChunk[] = [];

  for (const section of sections) {
    // Update heading stack for breadcrumb
    if (section.heading) {
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= section.level) {
        headingStack.pop();
      }
      headingStack.push({ heading: section.heading, level: section.level });
    }

    const bodyText = section.lines.join('\n').trim();
    if (!bodyText && !section.heading) continue;

    const breadcrumb = headingStack.map((h) => h.heading).join(' > ');
    const sectionContent = section.heading
      ? `${section.heading}\n\n${bodyText}`
      : bodyText;

    if (!sectionContent.trim()) continue;

    const sectionChunks = splitToFitTokenLimit(sectionContent, maxTokens);
    for (const part of sectionChunks) {
      chunks.push({
        content: part,
        chunkIndex: 0, // Set below
        totalChunks: 0, // Set below
        tokens: estimateTokens(part),
        metadata: { strategy: 'markdown-headers', breadcrumb },
      });
    }
  }

  // Finalize chunkIndex and totalChunks
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].chunkIndex = i;
    chunks[i].totalChunks = chunks.length;
  }

  return chunks;
}
