/**
 * Cross-document reference extraction — Parses markdown links, resolves
 * relative URLs, identifies cross-page references for building References
 * edges in the documentation graph.
 *
 * Ported from cli/kadi-docs/src/tools/graph-indexer.ts — the link parsing
 * and reference resolution logic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A parsed markdown link reference. */
export interface MarkdownLink {
  /** Link display text. */
  linkText: string;
  /** Raw link target (path or URL). */
  target: string;
  /** Position (character offset) in content. */
  offset: number;
}

/** A resolved cross-document reference. */
export interface CrossDocReference {
  /** Link display text. */
  linkText: string;
  /** Resolved slug of the target page. */
  targetSlug: string;
  /** Original source slug (the page containing the link). */
  sourceSlug: string;
  /** Whether the target was successfully resolved. */
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// Link parsing
// ---------------------------------------------------------------------------

/**
 * Parse markdown links from content, returning link details.
 * Matches [text](target) patterns.
 *
 * Filters out:
 *   - Anchor-only links (#section)
 *   - External HTTP links
 *   - Image URLs (.png, .jpg, .gif, .svg)
 */
export function parseMarkdownLinks(content: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const target = match[2].trim();

    // Skip anchor-only links
    if (target.startsWith('#')) continue;

    // Skip external HTTP(S) links
    if (target.startsWith('http://') || target.startsWith('https://')) continue;

    // Skip image URLs
    if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(target)) continue;

    links.push({
      linkText: match[1].trim(),
      target,
      offset: match.index,
    });
  }

  return links;
}

/**
 * Parse ALL markdown links including external ones.
 * Useful for reference analysis.
 */
export function parseAllMarkdownLinks(content: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const target = match[2].trim();
    if (target.startsWith('#')) continue; // Always skip anchor-only

    links.push({
      linkText: match[1].trim(),
      target,
      offset: match.index,
    });
  }

  return links;
}

// ---------------------------------------------------------------------------
// URL/slug resolution
// ---------------------------------------------------------------------------

/**
 * Normalize a link target to a documentation slug.
 *
 * Handles:
 *   - Relative paths: ../getting-started/first-agent.md → getting-started/first-agent
 *   - .md/.mdx extensions: removed
 *   - Leading ./ or ../: stripped
 *   - /docs/ prefix: stripped
 *   - Anchor fragments: stripped
 *
 * @param target     - Raw link target from markdown.
 * @param sourceSlug - Slug of the page containing the link (for relative resolution).
 * @returns Normalized slug string.
 */
export function normalizeTargetToSlug(target: string, sourceSlug: string): string {
  // Strip anchor fragments
  let cleaned = target.split('#')[0];

  // Remove .md/.mdx extension
  cleaned = cleaned.replace(/\.mdx?$/, '');

  // Remove /docs/ prefix
  cleaned = cleaned.replace(/^\/docs\//, '');

  // Handle relative paths
  if (cleaned.startsWith('./')) {
    cleaned = cleaned.slice(2);
  }

  if (cleaned.startsWith('../')) {
    // Resolve relative to source slug's directory
    const sourceParts = sourceSlug.split('/');
    sourceParts.pop(); // Remove filename part
    const targetParts = cleaned.split('/');

    while (targetParts[0] === '..') {
      targetParts.shift();
      if (sourceParts.length > 0) {
        sourceParts.pop();
      }
    }

    cleaned = [...sourceParts, ...targetParts].join('/');
  }

  // Remove leading/trailing slashes
  cleaned = cleaned.replace(/^\//, '').replace(/\/$/, '');

  return cleaned;
}

/**
 * Resolve a relative URL against a base URL.
 */
export function resolveRelativeUrl(baseUrl: string, relative: string): string {
  try {
    return new URL(relative, baseUrl).href;
  } catch {
    return relative;
  }
}

// ---------------------------------------------------------------------------
// Cross-doc reference extraction
// ---------------------------------------------------------------------------

/**
 * Extract cross-document references from page content.
 *
 * For each internal markdown link, resolves the target slug and checks
 * if it refers to a different page (different slug).
 *
 * @param content    - Markdown content to scan for links.
 * @param sourceSlug - Slug of the page being scanned.
 * @param knownSlugs - Set of all known documentation slugs (for validation).
 * @returns Array of resolved cross-document references.
 */
export function extractCrossDocReferences(
  content: string,
  sourceSlug: string,
  knownSlugs?: Set<string>,
): CrossDocReference[] {
  const links = parseMarkdownLinks(content);
  const references: CrossDocReference[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const targetSlug = normalizeTargetToSlug(link.target, sourceSlug);

    // Skip self-references
    if (targetSlug === sourceSlug) continue;

    // Skip empty slugs
    if (!targetSlug) continue;

    // Deduplicate: same source → target pair
    const key = `${sourceSlug}→${targetSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const resolved = knownSlugs ? knownSlugs.has(targetSlug) : true;

    references.push({
      linkText: link.linkText.substring(0, 200),
      targetSlug,
      sourceSlug,
      resolved,
    });
  }

  return references;
}
