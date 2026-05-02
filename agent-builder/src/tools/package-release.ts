/**
 * package_release Tool
 *
 * Zips the DaemonAgent Run/ folder (exe + DLLs + Data/) for GitHub release.
 * Excludes Logs/, Screenshots/, and .pdb files.
 * Reads VERSION file for naming the zip.
 */

import { z } from '@kadi.build/core';
import type { KadiClient } from '@kadi.build/core';
import { logger, MODULE_AGENT, timer } from 'agents-library';
import { getConfig } from './game-process.js';
import archiver from 'archiver';
import { createWriteStream, readFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

const inputSchema = z.object({
  config: z.enum(['Debug', 'Release']).optional().describe('Build configuration to package (default: from config.toml)'),
});

const outputSchema = z.object({
  success: z.boolean().describe('Whether the package was created successfully'),
  message: z.string().describe('Status message'),
  zipPath: z.string().describe('Absolute path to the created zip file'),
  sizeMB: z.number().describe('Zip file size in MB'),
  version: z.string().describe('Version string from VERSION file'),
  fileCount: z.number().describe('Number of files included in the zip'),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export function registerPackageReleaseTool(client: KadiClient): void {
  client.registerTool({
    name: 'package_release',
    description: 'Package DaemonAgent Run/ folder into a release zip (exe + DLLs + Data/, excludes Logs/Screenshots/.pdb)',
    input: inputSchema,
    output: outputSchema,
  }, async (params: Input): Promise<Output> => {
    logger.info(MODULE_AGENT, 'package_release: Starting...', timer.elapsed('main'));

    const cfg = getConfig();
    const runDir = cfg.gameWorkingDir;
    const repoRoot = dirname(runDir);

    // Read VERSION
    let version = 'unknown';
    try {
      version = readFileSync(join(repoRoot, 'VERSION'), 'utf-8').trim();
    } catch {
      logger.warn(MODULE_AGENT, 'package_release: VERSION file not found, using "unknown"', timer.elapsed('main'));
    }

    // Determine config
    const buildConfig = params.config || cfg.buildConfiguration;
    const exeName = `DaemonAgent_${buildConfig}_x64.exe`;

    // Output path
    const releasesDir = join(runDir, 'Releases');
    mkdirSync(releasesDir, { recursive: true });
    const zipName = `DaemonAgent-v${version}-${buildConfig}.zip`;
    const zipPath = join(releasesDir, zipName);

    logger.info(MODULE_AGENT, `package_release: Packaging ${buildConfig} build v${version}`, timer.elapsed('main'));

    // Create zip
    try {
      const { fileCount, sizeBytes } = await createReleaseZip(runDir, zipPath, exeName);

      const sizeMB = Math.round(sizeBytes / 1024 / 1024 * 10) / 10;
      logger.info(MODULE_AGENT, `package_release: Created ${zipName} (${sizeMB} MB, ${fileCount} files)`, timer.elapsed('main'));

      return {
        success: true,
        message: `Release package created: ${zipName} (${sizeMB} MB, ${fileCount} files)`,
        zipPath,
        sizeMB,
        version,
        fileCount,
      };
    } catch (error: unknown) {
      const msg = (error as Error).message;
      logger.error(MODULE_AGENT, `package_release: Failed — ${msg}`, timer.elapsed('main'));
      return {
        success: false,
        message: `Packaging failed: ${msg}`,
        zipPath: '',
        sizeMB: 0,
        version,
        fileCount: 0,
      };
    }
  });
}

function createReleaseZip(runDir: string, zipPath: string, exeName: string): Promise<{ fileCount: number; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    let fileCount = 0;

    archive.on('entry', () => { fileCount++; });
    archive.on('error', reject);

    output.on('close', () => {
      const sizeBytes = statSync(zipPath).size;
      resolve({ fileCount, sizeBytes });
    });

    archive.pipe(output);

    // Add the exe
    archive.file(join(runDir, exeName), { name: exeName });

    // Add all DLLs and .dat files in Run/ root
    archive.glob('*.dll', { cwd: runDir });
    archive.glob('*.dat', { cwd: runDir });

    // Add Data/ directory (scripts, images, fonts, audio, etc.)
    archive.directory(join(runDir, 'Data'), 'Data');

    // Explicitly exclude: Logs/, Screenshots/, Releases/, .pdb files
    // (archiver glob doesn't include subdirs we didn't add, and we didn't add those)

    archive.finalize();
  });
}
