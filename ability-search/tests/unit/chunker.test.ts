import { describe, expect, it } from 'vitest';

import { chunkContent, type Chunk } from '../../src/lib/chunker.js';

// Helper: all chunks have consistent shape
function validateChunks(chunks: Chunk[]): void {
  expect(chunks.length).toBeGreaterThan(0);
  for (let i = 0; i < chunks.length; i++) {
    expect(chunks[i].chunkIndex).toBe(i);
    expect(chunks[i].totalChunks).toBe(chunks.length);
    expect(chunks[i].tokens).toBeGreaterThan(0);
    expect(chunks[i].content.length).toBeGreaterThan(0);
    expect(chunks[i].metadata).toBeDefined();
  }
}

describe('chunkContent — markdown-headers', () => {
  it('splits by headings', () => {
    const content = `# Introduction

Some intro text.

## Methods

Methods description here.

## Results

Results go here.`;

    const chunks = chunkContent(content, 'markdown-headers');
    validateChunks(chunks);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves breadcrumb hierarchy', () => {
    const content = `# Main

## Sub

Content under sub.`;

    const chunks = chunkContent(content, 'markdown-headers');
    validateChunks(chunks);
    const subChunk = chunks.find((c) => c.content.includes('Content under sub'));
    expect(subChunk).toBeDefined();
    expect(subChunk!.metadata.breadcrumb).toBe('Main > Sub');
  });

  it('does not split fenced code blocks', () => {
    const content = `# Code Section

\`\`\`javascript
function hello() {
  console.log("hello");
}
\`\`\`

Some text after.`;

    const chunks = chunkContent(content, 'markdown-headers');
    validateChunks(chunks);
    // The code block should be entirely within one chunk
    const codeChunk = chunks.find((c) => c.content.includes('function hello'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.content).toContain('console.log');
  });
});

describe('chunkContent — code-blocks', () => {
  it('separates code blocks from prose', () => {
    const content = `Some introduction text.

\`\`\`python
def add(a, b):
    return a + b
\`\`\`

Some explanation.

\`\`\`python
def multiply(a, b):
    return a * b
\`\`\``;

    const chunks = chunkContent(content, 'code-blocks');
    validateChunks(chunks);

    const codeChunks = chunks.filter((c) => c.metadata.type === 'code');
    const proseChunks = chunks.filter((c) => c.metadata.type === 'prose');
    expect(codeChunks.length).toBe(2);
    expect(proseChunks.length).toBeGreaterThanOrEqual(1);
  });

  it('sets language metadata on code chunks', () => {
    const content = `\`\`\`typescript
const x = 1;
\`\`\``;

    const chunks = chunkContent(content, 'code-blocks');
    validateChunks(chunks);
    const codeChunk = chunks.find((c) => c.metadata.type === 'code');
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.metadata.language).toBe('typescript');
  });
});

describe('chunkContent — paragraph', () => {
  it('splits on double newlines', () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) =>
      `Paragraph ${i + 1} with enough text to be meaningful on its own.`,
    );
    const content = paragraphs.join('\n\n');

    const chunks = chunkContent(content, 'paragraph');
    validateChunks(chunks);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('merges short paragraphs', () => {
    const content = 'A.\n\nB.\n\nC.';
    const chunks = chunkContent(content, 'paragraph', { maxTokens: 500 });
    validateChunks(chunks);
    // Three very short paragraphs should merge into one
    expect(chunks.length).toBe(1);
  });

  it('splits long paragraphs at sentence boundaries', () => {
    const longPara = Array.from({ length: 100 }, (_, i) =>
      `Sentence number ${i + 1} in this very long paragraph.`,
    ).join(' ');

    const chunks = chunkContent(longPara, 'paragraph', { maxTokens: 50 });
    validateChunks(chunks);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('chunkContent — sliding-window', () => {
  it('creates overlapping windows', () => {
    const sentences = Array.from({ length: 20 }, (_, i) =>
      `This is sentence number ${i + 1}.`,
    );
    const content = sentences.join(' ');

    const chunks = chunkContent(content, 'sliding-window', {
      maxTokens: 30,
      overlap: 10,
    });
    validateChunks(chunks);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('returns single chunk for short content', () => {
    const chunks = chunkContent('Short content.', 'sliding-window');
    validateChunks(chunks);
    expect(chunks.length).toBe(1);
  });
});

describe('chunkContent — auto', () => {
  it('uses markdown-headers for content with 3+ headings', () => {
    const content = `# One\nText.\n\n## Two\nText.\n\n### Three\nText.`;
    const chunks = chunkContent(content, 'auto');
    validateChunks(chunks);
    // Should have detected markdown strategy
    const hasBreadcrumbs = chunks.some((c) => c.metadata.breadcrumb);
    expect(hasBreadcrumbs).toBe(true);
  });

  it('uses code-blocks for content with 3+ fenced blocks', () => {
    const content = `Text.\n\n\`\`\`js\na\n\`\`\`\n\nText.\n\n\`\`\`js\nb\n\`\`\`\n\nText.\n\n\`\`\`js\nc\n\`\`\``;
    const chunks = chunkContent(content, 'auto');
    validateChunks(chunks);
    const hasCode = chunks.some((c) => c.metadata.type === 'code');
    expect(hasCode).toBe(true);
  });

  it('falls back to paragraph for plain text', () => {
    const content = 'Just some plain text.\n\nAnother paragraph here.';
    const chunks = chunkContent(content, 'auto');
    validateChunks(chunks);
    // No breadcrumbs or code metadata
    expect(chunks.every((c) => !c.metadata.breadcrumb && !c.metadata.type)).toBe(true);
  });
});

describe('chunkContent — error handling', () => {
  it('throws on unknown strategy', () => {
    expect(() => chunkContent('text', 'invalid' as any)).toThrow(
      'Unknown chunk strategy',
    );
  });

  it('returns single chunk for empty-ish content', () => {
    const chunks = chunkContent('hello');
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe('hello');
  });
});
