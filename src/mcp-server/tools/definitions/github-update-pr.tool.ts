/**
 * @fileoverview Tool: github_update_pr — Edit a pull request.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../utils/toolDefinition.js';
import { createGitHubToolHandler, createJsonFormatter } from '../utils/toolHandlerFactory.js';
import type { GitHubToolDependencies } from '../utils/toolHandlerFactory.js';

const TOOL_NAME = 'github_update_pr';

const InputSchema = z.object({
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  pull_number: z.number().describe('Pull request number to update'),
  title: z.string().optional().describe('New title'),
  body: z.string().optional().describe('New description'),
  state: z.enum(['open', 'closed']).optional().describe('New state'),
  base: z.string().optional().describe('New base branch name'),
  maintainer_can_modify: z.boolean().optional().describe('Allow maintainer edits'),
});

const OutputSchema = z.object({
  success: z.boolean(),
  number: z.number(),
  url: z.string(),
  html_url: z.string(),
  title: z.string(),
  state: z.string(),
});

type ToolInput = z.infer<typeof InputSchema>;
type ToolOutput = z.infer<typeof OutputSchema>;

async function updatePrLogic(
  input: ToolInput,
  { provider }: GitHubToolDependencies,
): Promise<ToolOutput> {
  return provider.updatePullRequest(input);
}

export const githubUpdatePrTool: ToolDefinition<typeof InputSchema, typeof OutputSchema> = {
  name: TOOL_NAME,
  title: 'Update Pull Request',
  description:
    'Update an existing pull request. Can change title, body, state (open/close), base branch, and maintainer edit permissions.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: { openWorldHint: true },
  logic: createGitHubToolHandler(updatePrLogic),
  responseFormatter: createJsonFormatter<ToolOutput>(),
};
