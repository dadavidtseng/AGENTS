/**
 * @fileoverview Barrel file for all prompt definitions.
 * This file re-exports all prompt definitions for easy import and registration.
 * @module src/mcp-server/prompts/definitions
 */

import { gitWrapupPrompt } from './git-wrapup.prompt.js';

/**
 * An array containing all prompt definitions for easy iteration.
 */
export const allPromptDefinitions = [gitWrapupPrompt];
