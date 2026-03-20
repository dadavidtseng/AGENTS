/**
 * Chunking engine -- 5 strategies for splitting text content into indexable chunks.
 *
 * Strategies:
 *   - `markdown-headers`  -- Split on `#` headings with breadcrumb hierarchy
 *   - `code-blocks`       -- Separate fenced code blocks from prose
 *   - `paragraph`         -- Split on double newlines, merge short paragraphs
 *   - `sliding-window`    -- Fixed-size windows with configurable overlap
 *   - `auto`              -- Inspects content to pick the best strategy
 *
 * All strategies return `Chunk[]` with consistent shape: every chunk has a
 * zero-based `chunkIndex`, a `totalChunks` count, estimated `tokens`, and
 * strategy-specific `metadata`.
 */

import { estimateTokens, splitAtSentenceBoundary } from './tokens.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Metadata shared by all strategies. */
interface BaseChunkMetadata {
  strategy: ChunkStrategy;
}

/** Metadata for chunks produced by the `markdown-headers` strategy. */
interface MarkdownHeadersMetadata extends BaseChunkMetadata {
  strategy: 'markdown-headers';
  /** Heading hierarchy as "H1 > H2 > H3" breadcrumb trail. */
  breadcrumb: string;
}

/** Metadata for prose chunks produced by the `code-blocks` strategy. */
interface CodeBlocksProseMetadata extends BaseChunkMetadata {
  strategy: 'code-blocks';
  type: 'prose';
}

/** Metadata for code chunks produced by the `code-blocks` strategy. */
interface CodeBlocksCodeMetadata extends BaseChunkMetadata {
  strategy: 'code-blocks';
  type: 'code';
  /** Language identifier from the opening fence (e.g. "python", "typescript"). */
  language: string;
  /** Last 1-2 sentences of preceding prose, providing context for the code block. */
  context: string;
}

/** Metadata for chunks produced by the `paragraph` strategy. */
interface ParagraphMetadata extends BaseChunkMetadata {
  strategy: 'paragraph';
}

/** Metadata for chunks produced by the `sliding-window` strategy. */
interface SlidingWindowMetadata extends BaseChunkMetadata {
  strategy: 'sliding-window';
}

/** Metadata for fallback single-chunk results. */
interface FallbackMetadata extends BaseChunkMetadata {
  strategy: 'auto';
}

export type ChunkMetadata =
  | MarkdownHeadersMetadata
  | CodeBlocksProseMetadata
  | CodeBlocksCodeMetadata
  | ParagraphMetadata
  | SlidingWindowMetadata
  | FallbackMetadata;

/** A single chunk of indexed content. */
export interface Chunk {
  /** The text content of this chunk. */
  content: string;
  /** Zero-based index of this chunk within the result set. */
  chunkIndex: number;
  /** Total number of chunks in the result set. */
  totalChunks: number;
  /** Estimated token count (whitespace-based heuristic). */
  tokens: number;
  /** Strategy-specific metadata. */
  metadata: ChunkMetadata;
}

export interface ChunkOptions {
  /** Maximum estimated tokens per chunk. Defaults to 500. */
  maxTokens?: number;
  /** Overlap in tokens for sliding-window strategy. Defaults to 50. */
  overlap?: number;
}

export type ChunkStrategy =
  | 'markdown-headers'
  | 'code-blocks'
  | 'paragraph'
  | 'sliding-window'
  | 'auto';

// ---------------------------------------------------------------------------
// Fence detection
// ---------------------------------------------------------------------------

/** Regex matching the opening or closing line of a fenced code block. */
const FENCE_PATTERN = /^(`{3,}|~{3,})/;

/**
 * Test whether a line opens or closes a fenced code block.
 * Returns the language identifier on an opening fence, or `null` for a
 * closing fence / non-fence line.
 *
 * Handles both backtick and tilde fences, optional language identifiers,
 * and trailing content after the language tag (e.g. ` ```python title="ex" `).
 */
function parseFenceLine(
  line: string,
  inFencedBlock: boolean,
): { isFence: true; language: string } | { isFence: false } {
  const trimmed = line.trimStart();
  const match = trimmed.match(FENCE_PATTERN);
  if (!match) return { isFence: false };

  if (inFencedBlock) {
    // Closing fence: must be ONLY the fence characters (no trailing content
    // except whitespace). This matches CommonMark spec behavior.
    if (trimmed.trimEnd() === match[1] || trimmed.trimEnd().match(/^(`{3,}|~{3,})\s*$/)) {
      return { isFence: true, language: '' };
    }
    return { isFence: false };
  }

  // Opening fence: extract optional language identifier
  const afterFence = trimmed.slice(match[1].length).trim();
  const language = afterFence.split(/\s/)[0] || '';
  return { isFence: true, language };
}

// ---------------------------------------------------------------------------
// Strategy: markdown-headers
// ---------------------------------------------------------------------------

/** Represents one heading-delimited section of a markdown document. */
interface MarkdownSection {
  heading: string;
  level: number;
  lines: string[];
}

/**
 * Split on `#` headings. Preserves hierarchy as breadcrumbs in metadata.
 * Never splits fenced code blocks mid-block.
 *
 * Content before the first heading is preserved as a section with level 0
 * and an empty heading (it will appear in the output but won't affect the
 * breadcrumb trail of subsequent sections).
 */
function chunkByMarkdownHeaders(
  content: string,
  options: ChunkOptions,
): Chunk[] {
  const maxTokens = options.maxTokens ?? 500;
  const lines = content.split('\n');
  const sections = splitIntoMarkdownSections(lines);

  if (sections.length === 0) return [];

  const headingStack: Array<{ heading: string; level: number }> = [];
  const chunks: Chunk[] = [];

  for (const section of sections) {
    updateHeadingStack(headingStack, section);

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
        chunkIndex: 0,
        totalChunks: 0,
        tokens: estimateTokens(part),
        metadata: { strategy: 'markdown-headers', breadcrumb },
      });
    }
  }

  return finalizeChunks(chunks);
}

/**
 * Parse lines into heading-delimited sections, protecting fenced code blocks
 * from being split by headings that appear inside them.
 */
function splitIntoMarkdownSections(lines: string[]): MarkdownSection[] {
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
      // Flush the previous section before starting a new one
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

  // Flush the final section (also handles unclosed fenced blocks gracefully --
  // the remaining lines are captured as body text rather than being lost)
  if (currentLines.length > 0 || currentHeading) {
    sections.push({ heading: currentHeading, level: currentLevel, lines: currentLines });
  }

  return sections;
}

/**
 * Maintain a stack of ancestor headings so we can produce breadcrumb trails.
 * When a new heading appears, we pop any headings at the same level or deeper,
 * then push the new one.
 */
function updateHeadingStack(
  stack: Array<{ heading: string; level: number }>,
  section: MarkdownSection,
): void {
  if (!section.heading) return;

  while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
    stack.pop();
  }
  stack.push({ heading: section.heading, level: section.level });
}

// ---------------------------------------------------------------------------
// Strategy: code-blocks
// ---------------------------------------------------------------------------

/** A segment of content that is either prose or a fenced code block. */
interface ContentSegment {
  type: 'prose' | 'code';
  content: string;
  language: string;
}

/**
 * Each fenced code block becomes its own chunk with `metadata.language`.
 * Prose between code blocks becomes context chunks. Code chunks receive
 * the last 1-2 sentences of preceding prose in `metadata.context`.
 *
 * Unclosed fenced blocks are treated as code -- the remaining content
 * becomes a code segment rather than being silently dropped.
 */
function chunkByCodeBlocks(
  content: string,
  options: ChunkOptions,
): Chunk[] {
  const maxTokens = options.maxTokens ?? 500;
  const segments = splitIntoCodeSegments(content);
  const chunks: Chunk[] = [];
  let lastProseContext = '';

  for (const segment of segments) {
    const text = segment.content.trim();
    if (!text) continue;

    if (segment.type === 'prose') {
      lastProseContext = extractTrailingContext(text);
      const parts = splitToFitTokenLimit(text, maxTokens);
      for (const part of parts) {
        chunks.push({
          content: part,
          chunkIndex: 0,
          totalChunks: 0,
          tokens: estimateTokens(part),
          metadata: { strategy: 'code-blocks', type: 'prose' },
        });
      }
    } else {
      const codeContent = '```' + segment.language + '\n' + text + '\n```';
      chunks.push({
        content: codeContent,
        chunkIndex: 0,
        totalChunks: 0,
        tokens: estimateTokens(codeContent),
        metadata: {
          strategy: 'code-blocks',
          type: 'code',
          language: segment.language || 'unknown',
          context: lastProseContext,
        },
      });
    }
  }

  return finalizeChunks(chunks);
}

/**
 * Split content into alternating prose and code segments.
 * Code segments contain only the body (without fence lines).
 */
function splitIntoCodeSegments(content: string): ContentSegment[] {
  const lines = content.split('\n');
  const segments: ContentSegment[] = [];
  let currentType: 'prose' | 'code' = 'prose';
  let currentLines: string[] = [];
  let currentLang = '';
  let inFencedBlock = false;

  for (const line of lines) {
    const fence = parseFenceLine(line, inFencedBlock);
    if (fence.isFence) {
      if (!inFencedBlock) {
        // Opening fence: flush prose, start code segment
        if (currentLines.length > 0) {
          segments.push({ type: 'prose', content: currentLines.join('\n'), language: '' });
        }
        currentLines = [];
        currentType = 'code';
        currentLang = fence.language;
        inFencedBlock = true;
      } else {
        // Closing fence: flush code segment, return to prose
        segments.push({ type: 'code', content: currentLines.join('\n'), language: currentLang });
        currentLines = [];
        currentType = 'prose';
        currentLang = '';
        inFencedBlock = false;
      }
      continue;
    }
    currentLines.push(line);
  }

  // Flush remaining lines (handles unclosed fences -- content stays as
  // whatever type was active, preserving it rather than silently dropping)
  if (currentLines.length > 0) {
    segments.push({ type: currentType, content: currentLines.join('\n'), language: currentLang });
  }

  return segments;
}

/**
 * Extract the last 1-2 sentences from prose text to use as context
 * for a following code block. Uses a conservative split that avoids
 * breaking on common abbreviations and decimal numbers.
 */
function extractTrailingContext(text: string): string {
  // Split on sentence-ending punctuation followed by whitespace and a capital
  // letter or end-of-string. This avoids splitting on "e.g." or "3.14".
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z]|$)/);
  const trailing = sentences.slice(-2).join(' ');
  if (!trailing) return '';
  // Ensure the context ends with punctuation for clean presentation
  if (/[.!?]$/.test(trailing)) return trailing;
  return trailing + '.';
}

// ---------------------------------------------------------------------------
// Strategy: paragraph
// ---------------------------------------------------------------------------

/**
 * Split on double newlines. Merge consecutive short paragraphs to avoid
 * producing chunks that are too small to be useful for search. Split
 * long paragraphs at sentence boundaries.
 *
 * The merge threshold is 20% of `maxTokens` -- paragraphs below this
 * threshold are combined with adjacent paragraphs until the combined
 * size approaches `maxTokens`.
 */
function chunkByParagraph(
  content: string,
  options: ChunkOptions,
): Chunk[] {
  const maxTokens = options.maxTokens ?? 500;
  const paragraphs = content.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  if (paragraphs.length === 0) return [];

  const chunks: Chunk[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if (estimateTokens(para) > maxTokens) {
      // Flush the merge buffer before splitting the oversized paragraph
      if (buffer) {
        chunks.push(makeParagraphChunk(buffer));
        buffer = '';
      }
      const parts = splitToFitTokenLimit(para, maxTokens);
      for (const part of parts) {
        chunks.push(makeParagraphChunk(part));
      }
      continue;
    }

    const combined = buffer ? buffer + '\n\n' + para : para;
    if (estimateTokens(combined) > maxTokens) {
      // Adding this paragraph would exceed the limit -- flush and start fresh
      if (buffer) chunks.push(makeParagraphChunk(buffer));
      buffer = para;
    } else {
      buffer = combined;
    }
  }

  if (buffer) {
    chunks.push(makeParagraphChunk(buffer));
  }

  return finalizeChunks(chunks);
}

/** Create a chunk with paragraph strategy metadata. */
function makeParagraphChunk(content: string): Chunk {
  return {
    content,
    chunkIndex: 0,
    totalChunks: 0,
    tokens: estimateTokens(content),
    metadata: { strategy: 'paragraph' },
  };
}

// ---------------------------------------------------------------------------
// Strategy: sliding-window
// ---------------------------------------------------------------------------

/**
 * Fixed-size windows with configurable overlap. Boundaries snap to sentence
 * breaks so chunks read naturally rather than cutting mid-sentence.
 *
 * The overlap parameter controls how many tokens from the end of one window
 * appear at the beginning of the next, ensuring continuity for search
 * relevance across chunk boundaries.
 */
function chunkBySlidingWindow(
  content: string,
  options: ChunkOptions,
): Chunk[] {
  const maxTokens = options.maxTokens ?? 500;
  const overlap = options.overlap ?? 50;

  if (!content.trim()) return [];

  const sentences = splitIntoSentences(content);
  if (sentences.length === 0) return [];

  const chunks: Chunk[] = [];
  let windowStart = 0;

  while (windowStart < sentences.length) {
    // Build a window of sentences up to maxTokens
    let windowTokens = 0;
    let windowEnd = windowStart;

    while (windowEnd < sentences.length) {
      const sentenceTokens = estimateTokens(sentences[windowEnd]);
      // Always include at least one sentence per window to guarantee progress
      if (windowTokens + sentenceTokens > maxTokens && windowEnd > windowStart) {
        break;
      }
      windowTokens += sentenceTokens;
      windowEnd++;
    }

    const windowContent = sentences.slice(windowStart, windowEnd).join(' ').trim();
    if (windowContent) {
      chunks.push({
        content: windowContent,
        chunkIndex: 0,
        totalChunks: 0,
        tokens: estimateTokens(windowContent),
        metadata: { strategy: 'sliding-window' },
      });
    }

    // All sentences consumed -- we are done
    if (windowEnd >= sentences.length) break;

    // Walk backwards from windowEnd to find where the overlap region starts.
    // The next window begins at this position, producing the desired overlap.
    let overlapTokens = 0;
    let newStart = windowEnd;
    for (let i = windowEnd - 1; i >= windowStart; i--) {
      overlapTokens += estimateTokens(sentences[i]);
      if (overlapTokens >= overlap) {
        newStart = i;
        break;
      }
      newStart = i;
    }

    // Guarantee forward progress: never start the next window at or before
    // the current start position
    if (newStart <= windowStart) {
      newStart = windowStart + 1;
    }
    windowStart = newStart;
  }

  return finalizeChunks(chunks);
}

// ---------------------------------------------------------------------------
// Strategy: auto
// ---------------------------------------------------------------------------

/**
 * Count headings in content while ignoring those inside fenced code blocks.
 * This prevents false positives from markdown rendered inside code examples.
 */
function countRealHeadings(content: string): number {
  const lines = content.split('\n');
  let inFence = false;
  let count = 0;

  for (const line of lines) {
    const fence = parseFenceLine(line, inFence);
    if (fence.isFence) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#{1,6}\s+/.test(line)) {
      count++;
    }
  }

  return count;
}

/**
 * Count fenced code block pairs while correctly handling nested or unclosed
 * blocks. Only counts properly opened-and-closed pairs.
 */
function countCodeBlockPairs(content: string): number {
  const lines = content.split('\n');
  let inFence = false;
  let pairs = 0;

  for (const line of lines) {
    const fence = parseFenceLine(line, inFence);
    if (fence.isFence) {
      if (inFence) pairs++;
      inFence = !inFence;
    }
  }

  return pairs;
}

/**
 * Inspect content and pick the best strategy:
 *   - 3+ headings (outside code blocks) -> markdown-headers
 *   - 3+ complete fenced code block pairs -> code-blocks
 *   - otherwise -> paragraph
 */
function chunkAuto(content: string, options: ChunkOptions): Chunk[] {
  if (countRealHeadings(content) >= 3) {
    return chunkByMarkdownHeaders(content, options);
  }

  if (countCodeBlockPairs(content) >= 3) {
    return chunkByCodeBlocks(content, options);
  }

  return chunkByParagraph(content, options);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

type StrategyFn = (content: string, options: ChunkOptions) => Chunk[];

const strategies: Record<ChunkStrategy, StrategyFn> = {
  'markdown-headers': chunkByMarkdownHeaders,
  'code-blocks': chunkByCodeBlocks,
  paragraph: chunkByParagraph,
  'sliding-window': chunkBySlidingWindow,
  auto: chunkAuto,
};

/**
 * Chunk content using the specified strategy.
 *
 * Returns at least one chunk for any non-empty input. If the chosen strategy
 * produces zero chunks (e.g. because content is very short), a single
 * fallback chunk containing the full content is returned instead.
 *
 * @param content  - The text to chunk
 * @param strategy - One of the 5 supported strategies (defaults to `auto`)
 * @param options  - `maxTokens` and `overlap` (for sliding-window)
 * @returns Array of chunks with consistent shape
 */
export function chunkContent(
  content: string,
  strategy: ChunkStrategy = 'auto',
  options: ChunkOptions = {},
): Chunk[] {
  const fn = strategies[strategy];
  if (!fn) {
    throw new Error(`Unknown chunk strategy: "${strategy as string}"`);
  }

  const result = fn(content, options);
  if (result.length > 0) return result;

  return makeSingleChunk(content);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Wrap entire content as a single chunk. Returns an empty array for
 * whitespace-only or empty input.
 */
function makeSingleChunk(content: string): Chunk[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  return [
    {
      content: trimmed,
      chunkIndex: 0,
      totalChunks: 1,
      tokens: estimateTokens(trimmed),
      metadata: { strategy: 'auto' },
    },
  ];
}

/**
 * Assign sequential `chunkIndex` values and set `totalChunks` on every chunk.
 * Called as the final step of each strategy before returning.
 */
function finalizeChunks(chunks: Chunk[]): Chunk[] {
  const total = chunks.length;
  for (let i = 0; i < total; i++) {
    chunks[i].chunkIndex = i;
    chunks[i].totalChunks = total;
  }
  return chunks;
}

/**
 * Split text into pieces that each fit within `maxTokens`, cutting at
 * sentence boundaries where possible. Returns at least one piece for
 * non-empty input.
 */
function splitToFitTokenLimit(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining) {
    const [part, rest] = splitAtSentenceBoundary(remaining, maxTokens);
    if (!part.trim()) break;
    parts.push(part);
    remaining = rest;
  }

  return parts;
}

/**
 * Split text into sentences for sliding-window boundary snapping.
 * Handles `.`, `?`, and `!` followed by whitespace as delimiters.
 * Keeps the delimiter with the preceding sentence.
 */
function splitIntoSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map((s) => s.trim()).filter(Boolean);
}
