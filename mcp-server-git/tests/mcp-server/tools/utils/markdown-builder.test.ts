/**
 * @fileoverview Tests for MarkdownBuilder utility
 * @module tests/mcp-server/tools/utils/markdown-builder
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MarkdownBuilder,
  markdown,
} from '@/mcp-server/tools/utils/markdown-builder.js';

describe('MarkdownBuilder', () => {
  let builder: MarkdownBuilder;

  beforeEach(() => {
    builder = new MarkdownBuilder();
  });

  describe('headings', () => {
    it('should create h1 heading', () => {
      const result = builder.h1('Title').build();
      expect(result).toBe('# Title');
    });

    it('should create h1 heading with emoji', () => {
      const result = builder.h1('Success', '✅').build();
      expect(result).toBe('# ✅ Success');
    });

    it('should create h2 heading', () => {
      const result = builder.h2('Subtitle').build();
      expect(result).toBe('## Subtitle');
    });

    it('should create h3 heading', () => {
      const result = builder.h3('Section').build();
      expect(result).toBe('### Section');
    });

    it('should create h4 heading', () => {
      const result = builder.h4('Subsection').build();
      expect(result).toBe('#### Subsection');
    });
  });

  describe('key-value pairs', () => {
    it('should create bold key-value pair', () => {
      const result = builder.keyValue('Name', 'John Doe').build();
      expect(result).toBe('**Name:** John Doe');
    });

    it('should handle numeric values', () => {
      const result = builder.keyValue('Count', 42).build();
      expect(result).toBe('**Count:** 42');
    });

    it('should handle boolean values', () => {
      const result = builder.keyValue('Active', true).build();
      expect(result).toBe('**Active:** true');
    });

    it('should handle null values', () => {
      const result = builder.keyValue('Empty', null).build();
      expect(result).toBe('**Empty:** null');
    });

    it('should create plain key-value pair', () => {
      const result = builder.keyValuePlain('Name', 'John Doe').build();
      expect(result).toBe('Name: John Doe');
    });
  });

  describe('lists', () => {
    it('should create unordered list', () => {
      const result = builder.list(['item 1', 'item 2', 'item 3']).build();
      expect(result).toBe('- item 1\n- item 2\n- item 3');
    });

    it('should create ordered list', () => {
      const result = builder.list(['first', 'second', 'third'], true).build();
      expect(result).toBe('1. first\n2. second\n3. third');
    });

    it('should handle empty list', () => {
      const result = builder.list([]).build();
      expect(result).toBe('');
    });
  });

  describe('code blocks', () => {
    it('should create code block without language', () => {
      const result = builder.codeBlock('const x = 1;').build();
      expect(result).toBe('```\nconst x = 1;\n```');
    });

    it('should create code block with language', () => {
      const result = builder.codeBlock('const x = 1;', 'typescript').build();
      expect(result).toBe('```typescript\nconst x = 1;\n```');
    });

    it('should create inline code', () => {
      const result = builder
        .text('Use ')
        .inlineCode('git commit')
        .text(' to commit')
        .build();
      expect(result).toBe('Use `git commit` to commit');
    });
  });

  describe('paragraphs and text', () => {
    it('should create paragraph', () => {
      const result = builder.paragraph('This is a paragraph.').build();
      expect(result).toBe('This is a paragraph.');
    });

    it('should create blockquote', () => {
      const result = builder.blockquote('Important note').build();
      expect(result).toBe('> Important note');
    });

    it('should create multiline blockquote', () => {
      const result = builder.blockquote('Line 1\nLine 2').build();
      expect(result).toBe('> Line 1\n> Line 2');
    });
  });

  describe('links and formatting', () => {
    it('should create link', () => {
      const result = builder.link('Click here', 'https://example.com').build();
      expect(result).toBe('[Click here](https://example.com)');
    });

    it('should create horizontal rule', () => {
      const result = builder.hr().build();
      expect(result).toBe('---');
    });
  });

  describe('tables', () => {
    it('should create table', () => {
      const headers = ['Name', 'Age', 'City'];
      const rows = [
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ];
      const result = builder.table(headers, rows).build();

      expect(result).toBe(
        '| Name | Age | City |\n' +
          '| --- | --- | --- |\n' +
          '| Alice | 30 | NYC |\n' +
          '| Bob | 25 | LA |',
      );
    });

    it('should handle empty table', () => {
      const result = builder.table([], []).build();
      expect(result).toBe('');
    });

    it('should handle table with no rows', () => {
      const result = builder.table(['A', 'B'], []).build();
      expect(result).toBe('');
    });
  });

  describe('sections', () => {
    it('should create section with level 2 heading', () => {
      const result = builder
        .section('My Section', 2, () => {
          builder.paragraph('Section content');
        })
        .build();

      expect(result).toBe('## My Section\n\nSection content');
    });

    it('should create section with level 3 heading', () => {
      const result = builder
        .section('Subsection', 3, () => {
          builder.list(['item 1', 'item 2']);
        })
        .build();

      expect(result).toBe('### Subsection\n\n- item 1\n- item 2');
    });

    it('should nest sections', () => {
      const result = builder
        .section('Parent', 2, () => {
          builder.paragraph('Parent content');
          builder.section('Child', 3, () => {
            builder.paragraph('Child content');
          });
        })
        .build();

      expect(result).toContain('## Parent');
      expect(result).toContain('### Child');
    });
  });

  describe('details/summary', () => {
    it('should create collapsible details', () => {
      const result = builder
        .details('Click to expand', 'Hidden content here')
        .build();

      expect(result).toContain('<details>');
      expect(result).toContain('<summary>Click to expand</summary>');
      expect(result).toContain('Hidden content here');
      expect(result).toContain('</details>');
    });
  });

  describe('conditional content', () => {
    it('should add content when condition is true', () => {
      const result = builder
        .when(true, () => {
          builder.paragraph('Conditional content');
        })
        .build();

      expect(result).toBe('Conditional content');
    });

    it('should not add content when condition is false', () => {
      const result = builder
        .when(false, () => {
          builder.paragraph('Should not appear');
        })
        .build();

      expect(result).toBe('');
    });

    it('should support complex conditional logic', () => {
      const hasFiles = true;
      const fileCount = 3;

      const result = builder
        .h1('Status')
        .when(hasFiles, () => {
          builder.keyValue('Files', fileCount);
          builder.list(['file1', 'file2', 'file3']);
        })
        .build();

      expect(result).toContain('**Files:** 3');
      expect(result).toContain('- file1');
    });
  });

  describe('raw markdown', () => {
    it('should add raw markdown', () => {
      const result = builder.raw('**Custom** _markdown_').build();
      expect(result).toBe('**Custom** _markdown_');
    });

    it('should integrate raw markdown with other methods', () => {
      const result = builder
        .h1('Title')
        .raw('Some **bold** text\n\n')
        .paragraph('Regular paragraph')
        .build();

      expect(result).toContain('# Title');
      expect(result).toContain('Some **bold** text');
      expect(result).toContain('Regular paragraph');
    });
  });

  describe('chaining and composition', () => {
    it('should support method chaining', () => {
      const result = builder
        .h1('Document')
        .paragraph('Introduction')
        .h2('Section 1')
        .list(['item 1', 'item 2'])
        .h2('Section 2')
        .codeBlock('const x = 1;', 'typescript')
        .build();

      expect(result).toContain('# Document');
      expect(result).toContain('## Section 1');
      expect(result).toContain('## Section 2');
      expect(result).toContain('```typescript');
    });

    it('should handle complex document structure', () => {
      const result = builder
        .h1('Git Status')
        .keyValue('Branch', 'main')
        .keyValue('Clean', 'false')
        .section('Staged Changes', 2, () => {
          builder.h3('Modified').list(['file1.ts', 'file2.ts']);
        })
        .section('Unstaged Changes', 2, () => {
          builder.h3('Deleted').list(['old-file.ts']);
        })
        .build();

      expect(result).toContain('# Git Status');
      expect(result).toContain('**Branch:** main');
      expect(result).toContain('## Staged Changes');
      expect(result).toContain('### Modified');
      expect(result).toContain('## Unstaged Changes');
    });
  });

  describe('spacing and formatting', () => {
    it('should add blank lines for spacing', () => {
      const result = builder
        .paragraph('Paragraph 1')
        .blankLine()
        .paragraph('Paragraph 2')
        .build();

      expect(result).toContain('Paragraph 1\n\n\nParagraph 2');
    });

    it('should trim trailing whitespace in build()', () => {
      const result = builder
        .paragraph('Content')
        .blankLine()
        .blankLine()
        .build();

      expect(result.endsWith('\n')).toBe(false);
      expect(result).toBe('Content');
    });
  });

  describe('reset', () => {
    it('should reset builder to empty state', () => {
      builder.h1('First Document').paragraph('Content');
      builder.reset();
      const result = builder.h1('Second Document').build();

      expect(result).toBe('# Second Document');
      expect(result).not.toContain('First Document');
    });
  });

  describe('helper function', () => {
    it('should create builder via markdown() helper', () => {
      const result = markdown().h1('Test').paragraph('Content').build();

      expect(result).toContain('# Test');
      expect(result).toContain('Content');
    });
  });

  describe('real-world use cases', () => {
    it('should format git commit response', () => {
      const result = builder
        .h1('Commit Created Successfully')
        .keyValue('Commit Hash', 'abc123def456')
        .keyValue('Author', 'John Doe <john@example.com>')
        .keyValue('Date', '2025-10-10T12:00:00Z')
        .keyValue('Message', 'feat: add new feature')
        .section('Committed Files', 2, () => {
          builder.list(['src/file1.ts', 'src/file2.ts', 'tests/file1.test.ts']);
        })
        .section('Repository Status', 2, () => {
          builder.keyValue('Branch', 'main').keyValue('Clean', 'Yes');
        })
        .build();

      expect(result).toContain('# Commit Created Successfully');
      expect(result).toContain('**Commit Hash:** abc123def456');
      expect(result).toContain('## Committed Files');
      expect(result).toContain('## Repository Status');
      expect(result).toContain('- src/file1.ts');
    });

    it('should format git status response with conflicts', () => {
      const result = builder
        .h1('Git Status: feature-branch')
        .h2('⚠️ Conflicts', '⚠️')
        .list(['src/conflicted-file.ts', 'docs/README.md'])
        .section('Staged Changes', 2, () => {
          builder.h3('Modified').list(['src/updated.ts']);
        })
        .section('Unstaged Changes', 2, () => {
          builder.h3('Deleted').list(['src/old-file.ts']);
        })
        .build();

      expect(result).toContain('# Git Status: feature-branch');
      expect(result).toContain('## ⚠️ ⚠️ Conflicts');
      expect(result).toContain('src/conflicted-file.ts');
    });

    it('should format git blame response', () => {
      const blameData = [
        {
          line: 1,
          hash: 'abc1234',
          date: '2025-01-15',
          author: 'Alice',
          content: 'function foo() {',
        },
        {
          line: 2,
          hash: 'def5678',
          date: '2025-02-20',
          author: 'Bob',
          content: '  return 42;',
        },
      ];

      const tableRows = blameData.map((b) => [
        String(b.line),
        b.hash,
        b.date,
        b.author,
        b.content,
      ]);

      const result = builder
        .h1('Git Blame: src/example.ts')
        .keyValue('Total Lines', blameData.length)
        .table(['Line', 'Commit', 'Date', 'Author', 'Content'], tableRows)
        .build();

      expect(result).toContain('# Git Blame: src/example.ts');
      expect(result).toContain('**Total Lines:** 2');
      expect(result).toContain('| Line | Commit | Date | Author | Content |');
      expect(result).toContain(
        '| 1 | abc1234 | 2025-01-15 | Alice | function foo() { |',
      );
    });
  });
});
