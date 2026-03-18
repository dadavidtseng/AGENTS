/**
 * @fileoverview Markdown builder utility for creating well-structured, semantic markdown content
 * @module mcp-server/tools/utils/markdown-builder
 */

/**
 * Utility class for building well-formatted markdown content with consistent structure.
 *
 * This builder provides a fluent API for creating markdown documents with proper
 * spacing, hierarchy, and semantic structure. It helps eliminate string concatenation
 * and ensures consistent formatting across all tool response formatters.
 *
 * @example
 * ```typescript
 * const md = new MarkdownBuilder()
 *   .h1('Commit Created Successfully')
 *   .keyValue('Commit Hash', 'abc123def')
 *   .keyValue('Author', 'John Doe')
 *   .section('Files Changed', () => {
 *     md.list(['file1.ts', 'file2.ts']);
 *   });
 *
 * const markdown = md.build();
 * ```
 */
export class MarkdownBuilder {
  private sections: string[] = [];

  /**
   * Add a level 1 heading.
   * @param text - The heading text
   * @param emoji - Optional emoji to prepend
   * @returns this builder for chaining
   */
  h1(text: string, emoji?: string): this {
    const prefix = emoji ? `${emoji} ` : '';
    this.sections.push(`# ${prefix}${text}\n\n`);
    return this;
  }

  /**
   * Add a level 2 heading.
   * @param text - The heading text
   * @param emoji - Optional emoji to prepend
   * @returns this builder for chaining
   */
  h2(text: string, emoji?: string): this {
    const prefix = emoji ? `${emoji} ` : '';
    this.sections.push(`## ${prefix}${text}\n\n`);
    return this;
  }

  /**
   * Add a level 3 heading.
   * @param text - The heading text
   * @param emoji - Optional emoji to prepend
   * @returns this builder for chaining
   */
  h3(text: string, emoji?: string): this {
    const prefix = emoji ? `${emoji} ` : '';
    this.sections.push(`### ${prefix}${text}\n\n`);
    return this;
  }

  /**
   * Add a level 4 heading.
   * @param text - The heading text
   * @returns this builder for chaining
   */
  h4(text: string): this {
    this.sections.push(`#### ${text}\n\n`);
    return this;
  }

  /**
   * Add a bold key-value pair on a single line.
   * @param key - The key (will be bolded)
   * @param value - The value
   * @returns this builder for chaining
   */
  keyValue(key: string, value: string | number | boolean | null): this {
    const displayValue = value === null ? 'null' : String(value);
    this.sections.push(`**${key}:** ${displayValue}\n`);
    return this;
  }

  /**
   * Add a key-value pair without bolding (for less emphasis).
   * @param key - The key
   * @param value - The value
   * @returns this builder for chaining
   */
  keyValuePlain(key: string, value: string | number | boolean | null): this {
    const displayValue = value === null ? 'null' : String(value);
    this.sections.push(`${key}: ${displayValue}\n`);
    return this;
  }

  /**
   * Add a bulleted or numbered list.
   * @param items - Array of items to list
   * @param ordered - If true, creates a numbered list
   * @returns this builder for chaining
   */
  list(items: string[], ordered = false): this {
    if (items.length === 0) return this;

    const marker = ordered ? (i: number) => `${i + 1}.` : () => '-';
    this.sections.push(
      items.map((item, i) => `${marker(i)} ${item}`).join('\n') + '\n\n',
    );
    return this;
  }

  /**
   * Add a code block with optional language syntax highlighting.
   * @param content - The code content
   * @param language - Optional language identifier (e.g., 'typescript', 'diff', 'json')
   * @returns this builder for chaining
   */
  codeBlock(content: string, language = ''): this {
    this.sections.push(`\`\`\`${language}\n${content}\n\`\`\`\n\n`);
    return this;
  }

  /**
   * Add inline code (backticks).
   * @param code - The code text
   * @returns this builder for chaining
   */
  inlineCode(code: string): this {
    this.sections.push(`\`${code}\``);
    return this;
  }

  /**
   * Add a paragraph of text.
   * @param text - The paragraph content
   * @returns this builder for chaining
   */
  paragraph(text: string): this {
    this.sections.push(`${text}\n\n`);
    return this;
  }

  /**
   * Add a blockquote.
   * @param text - The quoted text
   * @returns this builder for chaining
   */
  blockquote(text: string): this {
    const lines = text.split('\n');
    const quoted = lines.map((line) => `> ${line}`).join('\n');
    this.sections.push(`${quoted}\n\n`);
    return this;
  }

  /**
   * Add a horizontal rule.
   * @returns this builder for chaining
   */
  hr(): this {
    this.sections.push('---\n\n');
    return this;
  }

  /**
   * Add a link.
   * @param text - The link text
   * @param url - The URL
   * @returns this builder for chaining
   */
  link(text: string, url: string): this {
    this.sections.push(`[${text}](${url})`);
    return this;
  }

  /**
   * Add a table from structured data.
   * @param headers - Array of column headers
   * @param rows - Array of rows, each row is an array of cell values
   * @returns this builder for chaining
   */
  table(headers: string[], rows: string[][]): this {
    if (headers.length === 0 || rows.length === 0) return this;

    // Header row
    this.sections.push(`| ${headers.join(' | ')} |\n`);

    // Separator row
    this.sections.push(`| ${headers.map(() => '---').join(' | ')} |\n`);

    // Data rows
    rows.forEach((row) => {
      this.sections.push(`| ${row.join(' | ')} |\n`);
    });

    this.sections.push('\n');
    return this;
  }

  /**
   * Add a section with a heading and callback for content.
   * This is useful for grouping related content.
   *
   * @example
   * ```typescript
   * md.section('Files Changed', () => {
   *   md.list(['file1.ts', 'file2.ts']);
   * });
   * ```
   *
   * @param title - The section heading
   * @param level - Heading level (2-4), defaults to 2
   * @param content - Callback function to build section content
   * @returns this builder for chaining
   */
  section(title: string, level: 2 | 3 | 4 = 2, content: () => void): this {
    switch (level) {
      case 2:
        this.h2(title);
        break;
      case 3:
        this.h3(title);
        break;
      case 4:
        this.h4(title);
        break;
    }
    content();
    return this;
  }

  /**
   * Add a collapsible details section (HTML details/summary).
   * Note: Not all markdown renderers support this.
   *
   * @param summary - The summary text (always visible)
   * @param details - The detailed content (collapsed by default)
   * @returns this builder for chaining
   */
  details(summary: string, details: string): this {
    this.sections.push(`<details>\n<summary>${summary}</summary>\n\n`);
    this.sections.push(`${details}\n\n`);
    this.sections.push(`</details>\n\n`);
    return this;
  }

  /**
   * Add raw markdown content directly.
   * Use this for custom formatting not covered by other methods.
   *
   * @param markdown - Raw markdown string
   * @returns this builder for chaining
   */
  raw(markdown: string): this {
    this.sections.push(markdown);
    return this;
  }

  /**
   * Add a blank line for spacing.
   * @returns this builder for chaining
   */
  blankLine(): this {
    this.sections.push('\n');
    return this;
  }

  /**
   * Add text without any formatting or line breaks.
   * Useful for inline text that will be followed by other inline elements.
   *
   * @param text - The text to add
   * @returns this builder for chaining
   */
  text(text: string): this {
    this.sections.push(text);
    return this;
  }

  /**
   * Conditionally add content based on a predicate.
   *
   * @example
   * ```typescript
   * md.when(files.length > 0, () => {
   *   md.h2('Files Changed').list(files);
   * });
   * ```
   *
   * @param condition - If true, execute the callback
   * @param content - Callback function to build conditional content
   * @returns this builder for chaining
   */
  when(condition: boolean, content: () => void): this {
    if (condition) {
      content();
    }
    return this;
  }

  /**
   * Build the final markdown string.
   * Trims trailing whitespace and ensures the document ends cleanly.
   *
   * @returns The complete markdown document as a string
   */
  build(): string {
    return this.sections.join('').trim();
  }

  /**
   * Reset the builder to start building a new document.
   * @returns this builder for chaining
   */
  reset(): this {
    this.sections = [];
    return this;
  }
}

/**
 * Helper function to create a MarkdownBuilder instance.
 * Provides a shorter alternative to `new MarkdownBuilder()`.
 *
 * @returns A new MarkdownBuilder instance
 */
export function markdown(): MarkdownBuilder {
  return new MarkdownBuilder();
}
