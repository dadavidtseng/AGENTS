/**
 * @fileoverview Tool: github_get_pr — Get pull request details.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../utils/toolDefinition.js';
import { createGitHubToolHandler, createJsonFormatter } from '../utils/toolHandlerFactory.js';
import type { GitHubToolDependencies } from '../utils/toolHandlerFactory.js';

const TOOL_NAME = 'github_get_pr';

const InputSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number'),
  include_diff: z.boolean().optional().describe('Include the full diff'),
  include_files: z.boolean().optional().describe('Include the list of changed files'),
});

const FileInfo = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
});

const OutputSchema = z.object({
  success: z.boolean(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  body: z.string(),
  user: z.string(),
  head: z.string(),
  base: z.string(),
  html_url: z.string(),
  mergeable: z.boolean().nullable(),
  merged: z.boolean(),
  comments_count: z.number(),
  review_comments_count: z.number(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
  diff: z.string().optional(),
  files: z.array(FileInfo).optional(),
});

type ToolInput = z.infer<typeof InputSchema>;
type ToolOutput = z.infer<typeof OutputSchema>;

async function getPrLogic(
  input: ToolInput,
  { provider }: GitHubToolDependencies,
): Promise<ToolOutput> {
  return provider.getPullRequest(input);
}

export const githubGetPrTool: ToolDefinition<typeof InputSchema, typeof OutputSchema> = {
  name: TOOL_NAME,
  title: 'Get Pull Request',
  description:
    'Get detailed information about a pull request, including title, state, body, merge status, and optionally the diff and changed files list.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  logic: createGitHubToolHandler(getPrLogic),
  responseFormatter: createJsonFormatter<ToolOutput>(),
};
