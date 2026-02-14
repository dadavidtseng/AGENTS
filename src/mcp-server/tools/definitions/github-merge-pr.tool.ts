/**
 * @fileoverview Tool: github_merge_pr — Merge a pull request.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../utils/toolDefinition.js';
import { createGitHubToolHandler, createJsonFormatter } from '../utils/toolHandlerFactory.js';
import type { GitHubToolDependencies } from '../utils/toolHandlerFactory.js';

const TOOL_NAME = 'github_merge_pr';

const InputSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number'),
  merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge strategy'),
  commit_title: z.string().optional().describe('Title for the merge commit'),
  commit_message: z.string().optional().describe('Extra detail for the merge commit'),
});

const OutputSchema = z.object({
  success: z.boolean(),
  sha: z.string(),
  message: z.string(),
  merged: z.boolean(),
});

type ToolInput = z.infer<typeof InputSchema>;
type ToolOutput = z.infer<typeof OutputSchema>;

async function mergePrLogic(
  input: ToolInput,
  { provider }: GitHubToolDependencies,
): Promise<ToolOutput> {
  return provider.mergePullRequest(input);
}

export const githubMergePrTool: ToolDefinition<typeof InputSchema, typeof OutputSchema> = {
  name: TOOL_NAME,
  title: 'Merge Pull Request',
  description:
    'Merge a pull request on GitHub. Supports merge, squash, and rebase strategies. Optionally set commit title and message.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: { openWorldHint: true },
  logic: createGitHubToolHandler(mergePrLogic),
  responseFormatter: createJsonFormatter<ToolOutput>(),
};
