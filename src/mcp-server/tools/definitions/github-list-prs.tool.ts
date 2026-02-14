/**
 * @fileoverview Tool: github_list_prs — List pull requests with filters.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../utils/toolDefinition.js';
import { createGitHubToolHandler, createJsonFormatter } from '../utils/toolHandlerFactory.js';
import type { GitHubToolDependencies } from '../utils/toolHandlerFactory.js';

const TOOL_NAME = 'github_list_prs';

const InputSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by state (default: open)'),
  head: z.string().optional().describe('Filter by head user/org and branch (e.g., "user:branch")'),
  base: z.string().optional().describe('Filter by base branch'),
  sort: z.enum(['created', 'updated', 'popularity', 'long-running']).optional().describe('Sort field'),
  direction: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
  per_page: z.number().min(1).max(100).optional().describe('Results per page (max 100)'),
  page: z.number().min(1).optional().describe('Page number'),
});

const PullRequestSummary = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  user: z.string(),
  head: z.string(),
  base: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  html_url: z.string(),
});

const OutputSchema = z.object({
  success: z.boolean(),
  total_count: z.number(),
  pull_requests: z.array(PullRequestSummary),
});

type ToolInput = z.infer<typeof InputSchema>;
type ToolOutput = z.infer<typeof OutputSchema>;

async function listPrsLogic(
  input: ToolInput,
  { provider }: GitHubToolDependencies,
): Promise<ToolOutput> {
  return provider.listPullRequests(input);
}

export const githubListPrsTool: ToolDefinition<typeof InputSchema, typeof OutputSchema> = {
  name: TOOL_NAME,
  title: 'List Pull Requests',
  description:
    'List pull requests in a GitHub repository. Filter by state, head branch, base branch. Supports pagination and sorting.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  logic: createGitHubToolHandler(listPrsLogic),
  responseFormatter: createJsonFormatter<ToolOutput>(),
};
