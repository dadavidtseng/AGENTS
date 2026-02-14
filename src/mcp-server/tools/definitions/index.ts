/**
 * @fileoverview Barrel export for all tool definitions.
 */
import { githubCreatePrTool } from './github-create-pr.tool.js';
import { githubGetPrTool } from './github-get-pr.tool.js';
import { githubListPrsTool } from './github-list-prs.tool.js';
import { githubMergePrTool } from './github-merge-pr.tool.js';
import { githubUpdatePrTool } from './github-update-pr.tool.js';

export const allToolDefinitions = [
  githubCreatePrTool,
  githubGetPrTool,
  githubListPrsTool,
  githubMergePrTool,
  githubUpdatePrTool,
];
