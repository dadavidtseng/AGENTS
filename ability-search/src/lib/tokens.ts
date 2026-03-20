/**
 * Lightweight token estimation without a tokenizer dependency.
 *
 * Uses a whitespace-based heuristic: word count * 1.3 approximates BPE token
 * count for English text. The 1.3 multiplier accounts for subword splits that
 * BPE tokenizers (GPT, LLaMA, etc.) apply — most English words map to 1-2
 * tokens, averaging ~1.3. This is intentionally conservative (overestimates
 * slightly) so chunks stay within model context limits.
 *
 * Accuracy: within ~10% for typical English prose. Less accurate for code,
 * URLs, or heavily punctuated text where BPE produces more subword tokens.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Average BPE tokens per whitespace-delimited word in English text.
 * Derived from empirical testing against tiktoken (cl100k_base).
 */
const TOKENS_PER_WORD = 1.3;

/**
 * Average characters per English word (including trailing space).
 * Used to convert token estimates back to approximate character positions.
 */
const CHARS_PER_WORD = 5;

/**
 * Extra characters beyond the estimated position to search for sentence
 * boundaries. Provides a buffer so we don't miss a boundary that falls
 * just past the estimated character limit.
 */
const SEARCH_BUFFER_CHARS = 200;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Estimate BPE token count from text using a whitespace heuristic. */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * TOKENS_PER_WORD);
}

/**
 * Split text at a sentence boundary so the first part fits within maxTokens.
 *
 * Strategy:
 *   1. If the full text fits, return it as-is.
 *   2. Estimate a character position for maxTokens and search that region
 *      for the last `. ` (period-space) sentence boundary.
 *   3. If no sentence boundary is found, fall back to the last word boundary.
 *   4. If even the first word exceeds the limit, return it anyway (we must
 *      make forward progress).
 *
 * Limitations:
 *   - Splits on `. ` only — abbreviations like "Dr. Smith" or "U.S. Army"
 *     may cause premature splits. This is acceptable for chunking where
 *     approximate boundaries are sufficient.
 *   - The character position estimate assumes ~5 chars/word and ~1.3
 *     tokens/word, which is less accurate for non-English or code-heavy text.
 *
 * @returns [first, rest] — first fits within maxTokens, rest is the remainder.
 */
export function splitAtSentenceBoundary(
  text: string,
  maxTokens: number,
): [string, string] {
  if (estimateTokens(text) <= maxTokens) {
    return [text, ''];
  }

  // Convert token limit back to an approximate character position:
  //   maxTokens / TOKENS_PER_WORD = estimated word count
  //   estimated word count * CHARS_PER_WORD = estimated character position
  const approxChars = Math.floor((maxTokens / TOKENS_PER_WORD) * CHARS_PER_WORD);
  const searchRegion = text.slice(0, Math.min(approxChars + SEARCH_BUFFER_CHARS, text.length));

  // Find the last `. ` sentence boundary within the search region
  // that still fits within the token limit.
  const sentencePos = findLastSentenceBoundary(text, searchRegion, maxTokens);
  if (sentencePos > 0) {
    return [text.slice(0, sentencePos).trimEnd(), text.slice(sentencePos).trimStart()];
  }

  // No sentence boundary found — split at the last word boundary
  return splitAtWordBoundary(text, maxTokens);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Scan the search region for `. ` boundaries, returning the character
 * position of the last one whose prefix fits within maxTokens.
 * Returns -1 if no valid boundary is found.
 */
function findLastSentenceBoundary(
  fullText: string,
  searchRegion: string,
  maxTokens: number,
): number {
  let splitPos = -1;
  let idx = 0;

  while (true) {
    const nextDot = searchRegion.indexOf('. ', idx);
    if (nextDot === -1) break;

    const candidate = nextDot + 2; // position after ". "
    if (estimateTokens(fullText.slice(0, candidate)) <= maxTokens) {
      splitPos = candidate;
      idx = candidate;
    } else {
      break;
    }
  }

  return splitPos;
}

/**
 * Split at the last word boundary that fits within maxTokens.
 * If even the first word exceeds the limit, returns it anyway to
 * guarantee forward progress.
 */
function splitAtWordBoundary(
  text: string,
  maxTokens: number,
): [string, string] {
  const words = text.split(/\s+/);
  let accumulated = '';

  for (let i = 0; i < words.length; i++) {
    const next = accumulated ? accumulated + ' ' + words[i] : words[i];

    if (estimateTokens(next) > maxTokens) {
      if (i === 0) {
        // Single word exceeds limit — return it to ensure forward progress
        return [words[0], words.slice(1).join(' ')];
      }
      return [accumulated, words.slice(i).join(' ')];
    }

    accumulated = next;
  }

  // All words fit (shouldn't reach here since the caller already checked,
  // but handles floating-point edge cases in the estimation).
  return [text, ''];
}
