/**
 * create_release Tool
 *
 * Creates a GitHub release using gh CLI with the packaged zip.
 * Reads VERSION file for tag/title, attaches the zip artifact.
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import { getConfig } from './game-process.js';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const inputSchema = z.object({
  zipPath: z.string().describe('Absolute path to the release zip file (from package_release)'),
  notes: z.string().optional().describe('Release notes (markdown). If omitted, auto-generates from version.'),
  draft: z.boolean().optional().describe('Create as draft release (default: false)'),
  prerelease: z.boolean().optional().describe('Mark as pre-release (default: false)'),
});

const outputSchema = z.object({
  success: z.boolean().describe('Whether the release was created successfully'),
  message: z.string().describe('Status message'),
  url: z.string().describe('GitHub release URL (empty if failed)'),
  tag: z.string().describe('Git tag created'),
  version: z.string().describe('Version string'),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export function registerCreateReleaseTool(client: KadiClient): void {
  client.registerTool({
    name: 'create_release',
    description: 'Create a GitHub release with gh CLI — tags the repo, uploads the release zip, returns the release URL',
    input: inputSchema,
    output: outputSchema,
  }, async (params: Input): Promise<Output> => {
    logger.info(MODULE_AGENT, 'create_release: Starting...', timer.elapsed('main'));

    const cfg = getConfig();
    const repoRoot = dirname(cfg.gameWorkingDir);

    // Read VERSION
    let version = 'unknown';
    try {
      version = readFileSync(join(repoRoot, 'VERSION'), 'utf-8').trim();
    } catch {
      return {
        success: false,
        message: 'VERSION file not found at repo root',
        url: '',
        tag: '',
        version: '',
      };
    }

    // Verify zip exists
    if (!existsSync(params.zipPath)) {
      return {
        success: false,
        message: `Zip file not found: ${params.zipPath}`,
        url: '',
        tag: `v${version}`,
        version,
      };
    }

    // Verify gh CLI is available
    try {
      execSync('gh --version', { encoding: 'utf-8', timeout: 5000 });
    } catch {
      return {
        success: false,
        message: 'gh CLI not found — install from https://cli.github.com',
        url: '',
        tag: `v${version}`,
        version,
      };
    }

    const tag = `v${version}`;
    const title = `DaemonAgent ${tag}`;
    const notes = params.notes || `Release ${tag}`;

    // Build gh command
    const flags: string[] = [];
    if (params.draft) flags.push('--draft');
    if (params.prerelease) flags.push('--prerelease');

    const cmd = `gh release create "${tag}" "${params.zipPath}" --title "${title}" --notes "${notes.replace(/"/g, '\\"')}" --repo dadavidtseng/DaemonAgent ${flags.join(' ')}`.trim();

    logger.info(MODULE_AGENT, `create_release: Running: ${cmd}`, timer.elapsed('main'));

    try {
      const output = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 60000,
        cwd: repoRoot,
      });

      const url = output.trim();
      logger.info(MODULE_AGENT, `create_release: Release created — ${url}`, timer.elapsed('main'));

      return {
        success: true,
        message: `Release ${tag} created successfully`,
        url,
        tag,
        version,
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message: string };
      const errorOutput = (err.stderr || err.message).trim();
      logger.error(MODULE_AGENT, `create_release: Failed — ${errorOutput}`, timer.elapsed('main'));

      return {
        success: false,
        message: `gh release create failed: ${errorOutput}`,
        url: '',
        tag,
        version,
      };
    }
  });
}
