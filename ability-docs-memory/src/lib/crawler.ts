/**
 * Page crawler — Fetches HTML/markdown content, parses headings, extracts
 * sections for documentation indexing.
 *
 * Ported from cli/kadi-docs/src/tools/graph-indexer.ts — the content loading
 * and page splitting logic.
 *
 * Supports two content sources:
 *   1. LLMs.txt files (llms-guides.txt, llms-api.txt) — split by --- boundaries
 *   2. Raw URL fetch — fetch HTML/markdown from a URL and extract content
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single page document extracted from content sources. */
export interface PageDocument {
  /** Page title from heading. */
  title: string;
  /** URL slug for identification (e.g., 'architecture/agent-model'). */
  slug: string;
  /** Full URL of the page. */
  pageUrl: string;
  /** Source identifier (e.g., 'docs/architecture/agent-model'). */
  source: string;
  /** Raw content of the page (markdown). */
  content: string;
}

/** Parsed heading from content. */
export interface ParsedHeading {
  /** Heading text. */
  text: string;
  /** Heading level (1-6). */
  level: number;
  /** Line number in the content. */
  line: number;
}

/** A section of a page with its heading context. */
export interface ContentSection {
  /** Heading for this section. */
  heading: string;
  /** Heading level (0 = no heading / preamble). */
  level: number;
  /** Content lines in this section. */
  lines: string[];
  /** Breadcrumb trail of parent headings. */
  headingPath: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HTTP request timeout in ms. */
const FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// LLMs.txt parsing and page splitting
// ---------------------------------------------------------------------------

/**
 * Parse llms.txt to build a title → pageUrl map.
 * Entries look like: `- [Title](https://docs.kadi.build/docs/path): Description`
 */
export function parseLlmsTxt(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const regex = /^-\s+\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    map.set(match[1].trim(), match[2].trim());
  }
  return map;
}

/**
 * Derive slug from a full pageUrl.
 * pageUrl: https://docs.kadi.build/docs/architecture/agent-model
 * → slug: architecture/agent-model
 */
export function slugFromUrl(pageUrl: string): string {
  const docsPrefix = '/docs/';
  const idx = pageUrl.indexOf(docsPrefix);
  if (idx === -1) {
    try {
      const url = new URL(pageUrl);
      return url.pathname.replace(/^\//, '').replace(/\/$/, '');
    } catch {
      return pageUrl;
    }
  }
  return pageUrl.substring(idx + docsPrefix.length).replace(/\/$/, '');
}

/**
 * Derive slug from heading text (fallback when llms.txt title doesn't match).
 */
export function slugFromHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Split llms-guides.txt or llms-api.txt into per-page documents.
 *
 * Content files use `---` (horizontal rule) as section separators.
 * Each section starts with `## Title`. However, `---` may also appear
 * within a single doc page (sub-sections), so unmatched sections are
 * merged into the preceding matched page.
 */
export function splitIntoPages(
  content: string,
  titleUrlMap: Map<string, string>,
  domain: string,
  sourcePrefix: string,
): PageDocument[] {
  const titleMatchesLlms = (title: string): { url: string; slug: string } | null => {
    const exact = titleUrlMap.get(title);
    if (exact) return { url: exact, slug: slugFromUrl(exact) };
    for (const [mapTitle, mapUrl] of titleUrlMap) {
      if (mapTitle.toLowerCase() === title.toLowerCase()) {
        return { url: mapUrl, slug: slugFromUrl(mapUrl) };
      }
    }
    return null;
  };

  const rawSections = content.split(/\n---\n/);
  const pages: PageDocument[] = [];

  for (const rawSection of rawSections) {
    const trimmed = rawSection.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^##\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : `Untitled ${sourcePrefix} page`;
    const match = titleMatchesLlms(title);

    if (match) {
      pages.push({
        title,
        slug: match.slug,
        pageUrl: match.url,
        source: `docs/${match.slug}`,
        content: trimmed,
      });
    } else if (pages.length > 0) {
      pages[pages.length - 1].content += '\n\n---\n\n' + trimmed;
    } else {
      const slug = slugFromHeading(title);
      const pageUrl = `https://${domain}/docs/${slug}`;
      pages.push({
        title,
        slug,
        pageUrl,
        source: `docs/${slug}`,
        content: trimmed,
      });
    }
  }

  return pages;
}

/**
 * Parse headings from markdown content.
 */
export function parseHeadings(content: string): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  const lines = content.split('\n');
  let inFencedBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track fenced code blocks
    if (/^(`{3,}|~{3,})/.test(line.trimStart())) {
      inFencedBlock = !inFencedBlock;
      continue;
    }
    if (inFencedBlock) continue;

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      headings.push({
        text: headingMatch[2].trim(),
        level: headingMatch[1].length,
        line: i,
      });
    }
  }

  return headings;
}

/**
 * Extract sections from markdown content, grouped by headings.
 */
export function extractSections(content: string): ContentSection[] {
  const lines = content.split('\n');
  const sections: ContentSection[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];
  let inFencedBlock = false;
  const headingStack: Array<{ heading: string; level: number }> = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
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
        const headingPath = headingStack.map((h) => h.heading).join(' > ');
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          lines: currentLines,
          headingPath,
        });
      }

      const newLevel = headingMatch[1].length;
      const newHeading = headingMatch[2].trim();

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= newLevel) {
        headingStack.pop();
      }
      headingStack.push({ heading: newHeading, level: newLevel });

      currentHeading = newHeading;
      currentLevel = newLevel;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 || currentHeading) {
    const headingPath = headingStack.map((h) => h.heading).join(' > ');
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      lines: currentLines,
      headingPath,
    });
  }

  return sections;
}

/**
 * Fetch content from a URL. Supports HTML and markdown.
 * Returns raw text content.
 */
export async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'kadi-docs-memory-ability/1.0',
        'Accept': 'text/html, text/markdown, text/plain, */*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Strip HTML tags to extract plain text content.
 * Basic implementation — handles common documentation HTML.
 */
export function stripHtml(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Convert headings to markdown
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, level, text) =>
      '\n' + '#'.repeat(Number(level)) + ' ' + text.trim() + '\n',
    )
    // Convert paragraphs and divs to newlines
    .replace(/<\/?(p|div|br|li|tr)[^>]*>/gi, '\n')
    // Convert links to markdown
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    // Convert code blocks
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
