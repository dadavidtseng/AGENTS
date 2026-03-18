/**
 * @fileoverview Tool: github_create_pr — Create a new pull request.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../utils/toolDefinition.js';
import { createGitHubToolHandler, createJsonFormatter } from '../utils/toolHandlerFactory.js';
import type { GitHubToolDependencies } from '../utils/toolHandlerFactory.js';

const TOOL_NAME = 'github_create_pr';

const InputSchema = z.object({
  owner: z.string().describe('Repository owner (user or organization)'),
  repo: z.string().describe('Repository name'),
  title: z.string().describe('Pull request title'),
  head: z.string().describe('Branch containing changes'),
  base: z.string().describe('Branch to merge into'),
  body: z.string().optional().describe('Pull request description'),
  draft: z.boolean().optional().describe('Create as draft PR'),
  maintainer_can_modify: z.boolean().optional().describe('Allow maintainer edits'),
});

const OutputSchema = z.object({
  success: z.boolean(),
  number: z.number(),
  url: z.string(),
  html_url: z.string(),
  state: z.string(),
  title: z.string(),
  head: z.string(),
  base: z.string(),
  draft: z.boolean().optional(),
});

type ToolInput = z.infer<typeof InputSchema>;
type ToolOutput = z.infer<typeof OutputSchema>;

async function createPrLogic(
  input: ToolInput,
  { provider }: GitHubToolDependencies,
): Promise<ToolOutput> {
  return provider.createPullRequest(input);
}

export const githubCreatePrTool: ToolDefinition<typeof InputSchema, typeof OutputSchema> = {
  name: TOOL_NAME,
  title: 'Create Pull Request',
  description:
    'Create a new pull request on GitHub. Requires owner, repo, title, head branch, and base branch. Optionally set body, draft status, and maintainer edit permissions.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: { openWorldHint: true },
  logic: createGitHubToolHandler(createPrLogic),
  responseFormatter: createJsonFormatter<ToolOutput>(),
};
