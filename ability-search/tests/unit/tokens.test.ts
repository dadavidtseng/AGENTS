import { describe, expect, it } from 'vitest';

import { estimateTokens, splitAtSentenceBoundary } from '../../src/lib/tokens.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(estimateTokens('   \n\t  ')).toBe(0);
  });

  it('estimates tokens for a single word', () => {
    expect(estimateTokens('hello')).toBe(Math.ceil(1 * 1.3));
  });

  it('estimates tokens for a sentence', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const wordCount = 9;
    expect(estimateTokens(text)).toBe(Math.ceil(wordCount * 1.3));
  });

  it('handles multiple whitespace types', () => {
    const text = 'hello\tworld\nfoo  bar';
    // 4 words
    expect(estimateTokens(text)).toBe(Math.ceil(4 * 1.3));
  });
});

describe('splitAtSentenceBoundary', () => {
  it('returns full text when within limit', () => {
    const text = 'Short text.';
    const [first, rest] = splitAtSentenceBoundary(text, 100);
    expect(first).toBe('Short text.');
    expect(rest).toBe('');
  });

  it('splits at sentence boundary', () => {
    const text = 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence. Sixth sentence. Seventh sentence. Eighth sentence. Ninth sentence. Tenth sentence.';
    const [first, rest] = splitAtSentenceBoundary(text, 20);
    // Should split at a ". " boundary
    expect(first).toMatch(/\.$/);
    expect(rest.length).toBeGreaterThan(0);
    // Combined should equal original
    expect((first + ' ' + rest).replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('splits at word boundary when no sentence boundary exists', () => {
    const text = 'word '.repeat(100).trim();
    const [first, rest] = splitAtSentenceBoundary(text, 10);
    expect(first.length).toBeGreaterThan(0);
    expect(rest.length).toBeGreaterThan(0);
    // Both parts should contain only whole words
    expect(first.split(' ').every((w) => w === 'word')).toBe(true);
    expect(rest.split(' ').every((w) => w === 'word')).toBe(true);
  });

  it('handles single oversized word', () => {
    const text = 'superlongword rest';
    const [first, rest] = splitAtSentenceBoundary(text, 1);
    expect(first).toBe('superlongword');
    expect(rest).toBe('rest');
  });
});
