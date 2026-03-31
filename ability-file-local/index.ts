/**
 * ability-file-local — Local File Operations
 *
 * Provides local file/folder operations: list, move, copy, delete, create, watch,
 * compress, decompress, and search. All paths are validated against traversal attacks.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { KadiClient, z } from '@kadi.build/core';

dotenv.config();

// ============================================================================
// Path Security
// ============================================================================

function validatePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Path must be a non-empty string');
  }
  if (inputPath.includes('\0')) {
    throw new Error('Path contains null bytes');
  }
  const normalized = path.normalize(inputPath);
  if (normalized.includes('..')) {
    throw new Error(`Path traversal detected: ${inputPath}`);
  }
  return path.resolve(inputPath);
}

type AnyArgs = Record<string, unknown>;

function withPathValidation(
  fields: string[],
  handler: (args: AnyArgs) => Promise<AnyArgs>,
): (args: AnyArgs) => Promise<AnyArgs> {
  return async (args) => {
    try {
      const v = { ...args };
      for (const f of fields) {
        if (v[f] !== undefined) v[f] = validatePath(v[f] as string);
      }
      return handler(v);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Path validation error: ${msg}` };
    }
  };
}

// ============================================================================
// Helpers
// ============================================================================

function getDirSize(dirPath: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += getDirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

function countFiles(dirPath: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) count += countFiles(full);
    else count++;
  }
  return count;
}

function searchDir(
  dirPath: string, query: RegExp, recursive: boolean,
  filesOnly: boolean, results: Array<{ name: string; path: string; size: number; modified: string }>,
  limit: number,
): void {
  if (results.length >= limit) return;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (results.length >= limit) return;
      const full = path.join(dirPath, entry.name);
      if (query.test(entry.name)) {
        if (filesOnly && entry.isDirectory()) continue;
        const st = fs.statSync(full);
        results.push({ name: entry.name, path: full, size: st.size, modified: st.mtime.toISOString() });
      }
      if (recursive && entry.isDirectory()) {
        searchDir(full, query, recursive, filesOnly, results, limit);
      }
    }
  } catch { /* skip unreadable dirs */ }
}

// ============================================================================
// KadiClient
// ============================================================================

const brokerConfig: { url: string; networks?: string[] } = {
  url: process.env.KADI_BROKER_URL || 'ws://localhost:8080/kadi',
};
if (process.env.KADI_NETWORK) {
  brokerConfig.networks = [process.env.KADI_NETWORK];
}

const client = new KadiClient({
  name: 'ability-file-local',
  brokers: { default: brokerConfig },
});

// ============================================================================
// Watcher State
// ============================================================================

const activeWatchers = new Map<string, { close(): Promise<void> }>();

// ============================================================================
// LOCAL FILE OPERATIONS
// ============================================================================

// 1. List files and folders
client.registerTool({
  name: 'list_files_and_folders',
  description: 'List files and folders in a local directory',
  input: z.object({
    dirPath: z.string().describe('Directory path to list'),
  }),
}, withPathValidation(['dirPath'], ({ dirPath }) =>
  new Promise((resolve) => {
    fs.readdir(dirPath as string, { withFileTypes: true }, (err, files) => {
      if (err) return resolve({ success: false, error: err.message });
      resolve({
        success: true,
        files: files.map((f) => ({ name: f.name, type: f.isDirectory() ? 'folder' : 'file' })),
      });
    });
  }),
));

// 2. Move / rename
client.registerTool({
  name: 'move_and_rename',
  description: 'Move or rename a file or folder locally',
  input: z.object({
    oldPath: z.string().describe('Current path'),
    newPath: z.string().describe('New path'),
  }),
}, withPathValidation(['oldPath', 'newPath'], ({ oldPath, newPath }) =>
  new Promise((resolve) => {
    fs.rename(oldPath as string, newPath as string, (err) => {
      if (err) return resolve({ success: false, message: err.message });
      resolve({ success: true, message: `Moved ${oldPath} to ${newPath}` });
    });
  }),
));

// 3. Copy a file
client.registerTool({
  name: 'copy_file',
  description: 'Copy a file locally',
  input: z.object({
    sourcePath: z.string().describe('Source file path'),
    destPath: z.string().describe('Destination file path'),
  }),
}, withPathValidation(['sourcePath', 'destPath'], ({ sourcePath, destPath }) =>
  new Promise((resolve) => {
    fs.copyFile(sourcePath as string, destPath as string, (err) => {
      if (err) return resolve({ success: false, message: err.message });
      resolve({ success: true, message: `Copied ${sourcePath} to ${destPath}` });
    });
  }),
));

// 4. Delete a file or folder
client.registerTool({
  name: 'delete_file_or_folder',
  description: 'Delete a file or folder locally',
  input: z.object({
    targetPath: z.string().describe('Path to delete'),
  }),
}, withPathValidation(['targetPath'], ({ targetPath }) =>
  new Promise((resolve) => {
    fs.rm(targetPath as string, { recursive: true, force: true }, (err) => {
      if (err) return resolve({ success: false, message: err.message });
      resolve({ success: true, message: `Deleted ${targetPath}` });
    });
  }),
));

// 5. Create a folder
client.registerTool({
  name: 'create_folder',
  description: 'Create a new folder locally (recursive)',
  input: z.object({
    folderPath: z.string().describe('Folder path to create'),
  }),
}, withPathValidation(['folderPath'], ({ folderPath }) =>
  new Promise((resolve) => {
    fs.mkdir(folderPath as string, { recursive: true }, (err) => {
      if (err) return resolve({ success: false, message: err.message });
      resolve({ success: true, message: `Created folder ${folderPath}` });
    });
  }),
));

// 6. Create a file
client.registerTool({
  name: 'create_file',
  description: 'Create a new file with optional content',
  input: z.object({
    filePath: z.string().describe('File path to create'),
    content: z.string().optional().describe('File content (default: empty)'),
  }),
}, withPathValidation(['filePath'], ({ filePath, content }) =>
  new Promise((resolve) => {
    fs.writeFile(filePath as string, (content as string) || '', (err) => {
      if (err) return resolve({ success: false, message: err.message });
      resolve({ success: true, message: `Created file ${filePath}` });
    });
  }),
));

// 7. Read a file (text or binary as base64)
client.registerTool({
  name: 'read_file',
  description: 'Read a local file. Text files return content as string. Binary files (images, etc.) return base64-encoded content with a data URI prefix.',
  input: z.object({
    filePath: z.string().describe('File path to read'),
    encoding: z.enum(['auto', 'text', 'base64']).optional().describe('Encoding: auto (detect by extension), text (utf-8), or base64. Default: auto'),
  }),
}, withPathValidation(['filePath'], async ({ filePath, encoding }) => {
  const fp = filePath as string;
  const enc = (encoding as string) || 'auto';

  if (!fs.existsSync(fp)) {
    return { success: false, message: `File not found: ${fp}` };
  }

  const stat = fs.statSync(fp);
  if (stat.isDirectory()) {
    return { success: false, message: `Path is a directory: ${fp}` };
  }

  const ext = path.extname(fp).toLowerCase();
  const binaryExts = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    '.mp3', '.mp4', '.wav', '.avi', '.mov',
    '.exe', '.dll', '.so', '.dylib', '.wasm',
  ]);
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  };

  const isBinary = enc === 'base64' || (enc === 'auto' && binaryExts.has(ext));

  if (isBinary) {
    const buffer = fs.readFileSync(fp);
    const b64 = buffer.toString('base64');
    const mime = mimeMap[ext] || 'application/octet-stream';
    return {
      success: true, filePath: fp, size: stat.size,
      encoding: 'base64', contentType: mime,
      dataUri: `data:${mime};base64,${b64}`,
    };
  }

  const content = fs.readFileSync(fp, 'utf-8');
  return { success: true, filePath: fp, size: stat.size, encoding: 'text', content };
}));

// 8. Watch a directory for changes
client.registerTool({
  name: 'watch_folder',
  description: 'Watch a folder for file changes',
  input: z.object({
    folderPath: z.string().describe('Folder path to watch'),
    watchId: z.string().optional().describe('Unique ID for this watcher'),
  }),
}, withPathValidation(['folderPath'], async ({ folderPath, watchId }) => {
  const id = (watchId as string) || (folderPath as string);
  if (activeWatchers.has(id)) {
    return { success: false, message: `Watcher "${id}" already active` };
  }
  try {
    const { default: chokidar } = await import('chokidar');
    const watcher = chokidar.watch(folderPath as string, { ignoreInitial: true });
    watcher.on('all', (event: string, fp: string) => {
      client.emit('file.changed', { watchId: id, event, path: fp });
    });
    activeWatchers.set(id, watcher);
    return { success: true, message: `Watching ${folderPath} (id: ${id})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Error: ${msg}` };
  }
}));

// 9. Stop watching a folder
client.registerTool({
  name: 'unwatch_folder',
  description: 'Stop watching a folder',
  input: z.object({
    watchId: z.string().describe('Watcher ID to stop'),
  }),
}, async ({ watchId }) => {
  const watcher = activeWatchers.get(watchId);
  if (!watcher) {
    return { success: false, message: `No active watcher "${watchId}"` };
  }
  await watcher.close();
  activeWatchers.delete(watchId);
  return { success: true, message: `Stopped watching (id: ${watchId})` };
});

// ============================================================================
// COMPRESSION OPERATIONS
// ============================================================================

// 10. Compress file or folder
client.registerTool({
  name: 'compress_file',
  description: 'Compress a file or folder into a zip or tar.gz archive',
  input: z.object({
    inputPath: z.string().describe('File or folder to compress'),
    outputPath: z.string().describe('Output archive path'),
    format: z.enum(['zip', 'tar.gz']).default('zip').describe('Archive format'),
    compressionLevel: z.number().min(0).max(9).default(6).describe('Compression level (0-9)'),
  }),
}, withPathValidation(['inputPath', 'outputPath'], async ({ inputPath, outputPath, format, compressionLevel }) => {
  const inPath = inputPath as string;
  const outPath = outputPath as string;
  const fmt = (format as string) || 'zip';
  const level = (compressionLevel as number) ?? 6;

  try {
    const stats = fs.statSync(inPath);
    const originalSize = stats.isDirectory()
      ? getDirSize(inPath)
      : stats.size;

    // Ensure output dir exists
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    if (fmt === 'zip') {
      const archiver = (await import('archiver')).default;
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level } });
        output.on('close', () => resolve());
        archive.on('error', reject);
        archive.pipe(output);
        if (stats.isDirectory()) {
          archive.directory(inPath, false);
        } else {
          archive.file(inPath, { name: path.basename(inPath) });
        }
        archive.finalize();
      });
    } else {
      const tar = (await import('tar')).default;
      const cwd = stats.isDirectory() ? inPath : path.dirname(inPath);
      const entries = stats.isDirectory() ? ['.'] : [path.basename(inPath)];
      await tar.create({ file: outPath, gzip: { level }, cwd }, entries);
    }

    const compressedSize = fs.statSync(outPath).size;
    const ratio = originalSize > 0 ? ((originalSize - compressedSize) / originalSize * 100).toFixed(1) : '0';

    return {
      success: true,
      archivePath: outPath,
      originalSize,
      compressedSize,
      compressionRatio: `${ratio}%`,
      format: fmt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Compression failed: ${msg}` };
  }
}));

// 11. Decompress archive
client.registerTool({
  name: 'decompress_file',
  description: 'Decompress a zip or tar.gz archive',
  input: z.object({
    archivePath: z.string().describe('Archive file path'),
    outputDirectory: z.string().describe('Output directory'),
  }),
}, withPathValidation(['archivePath', 'outputDirectory'], async ({ archivePath, outputDirectory }) => {
  const arcPath = archivePath as string;
  const outDir = outputDirectory as string;

  try {
    fs.mkdirSync(outDir, { recursive: true });
    const ext = arcPath.toLowerCase();
    let extractedFiles = 0;

    if (ext.endsWith('.zip')) {
      const unzipper = await import('unzipper');
      const dir = await unzipper.Open.file(arcPath);
      for (const file of dir.files) {
        const filePath = path.join(outDir, file.path);
        if (file.type === 'Directory') {
          fs.mkdirSync(filePath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          const content = await file.buffer();
          fs.writeFileSync(filePath, content);
          extractedFiles++;
        }
      }
    } else {
      const tar = (await import('tar')).default;
      await tar.extract({ file: arcPath, cwd: outDir });
      // Count extracted files
      extractedFiles = countFiles(outDir);
    }

    return {
      success: true,
      extractedFiles,
      outputDirectory: outDir,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Decompression failed: ${msg}` };
  }
}));

// 12. Batch compress
client.registerTool({
  name: 'compress_multiple_files',
  description: 'Compress multiple files/folders into individual archives',
  input: z.object({
    inputPaths: z.array(z.string()).describe('List of file/folder paths to compress'),
    outputDirectory: z.string().describe('Output directory for archives'),
    format: z.enum(['zip', 'tar.gz']).default('zip').describe('Archive format'),
  }),
}, withPathValidation(['outputDirectory'], async ({ inputPaths, outputDirectory, format }) => {
  const outDir = outputDirectory as string;
  const fmt = (format as string) || 'zip';
  const ext = fmt === 'zip' ? '.zip' : '.tar.gz';
  fs.mkdirSync(outDir, { recursive: true });

  const results: Array<{ file: string; success: boolean; error?: string }> = [];
  for (const inp of inputPaths as string[]) {
    try {
      const safePath = validatePath(inp);
      const outPath = path.join(outDir, path.parse(safePath).name + ext);
      const stats = fs.statSync(safePath);

      if (fmt === 'zip') {
        const archiver = (await import('archiver')).default;
        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(outPath);
          const archive = archiver('zip', { zlib: { level: 6 } });
          output.on('close', () => resolve());
          archive.on('error', reject);
          archive.pipe(output);
          if (stats.isDirectory()) archive.directory(safePath, false);
          else archive.file(safePath, { name: path.basename(safePath) });
          archive.finalize();
        });
      } else {
        const tar = (await import('tar')).default;
        const cwd = stats.isDirectory() ? safePath : path.dirname(safePath);
        const entries = stats.isDirectory() ? ['.'] : [path.basename(safePath)];
        await tar.create({ file: outPath, gzip: true, cwd }, entries);
      }
      results.push({ file: inp, success: true });
    } catch (err) {
      results.push({ file: inp, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { success: true, results };
}));

// 13. Batch decompress
client.registerTool({
  name: 'decompress_multiple_files',
  description: 'Decompress multiple archive files',
  input: z.object({
    archivePaths: z.array(z.string()).describe('List of archive file paths'),
    outputDirectory: z.string().describe('Output directory'),
  }),
}, withPathValidation(['outputDirectory'], async ({ archivePaths, outputDirectory }) => {
  const outDir = outputDirectory as string;
  const results: Array<{ file: string; success: boolean; error?: string }> = [];

  for (const arc of archivePaths as string[]) {
    try {
      const safePath = validatePath(arc);
      const subDir = path.join(outDir, path.parse(safePath).name);
      fs.mkdirSync(subDir, { recursive: true });

      if (safePath.toLowerCase().endsWith('.zip')) {
        const unzipper = await import('unzipper');
        const dir = await unzipper.Open.file(safePath);
        for (const file of dir.files) {
          const fp = path.join(subDir, file.path);
          if (file.type === 'Directory') {
            fs.mkdirSync(fp, { recursive: true });
          } else {
            fs.mkdirSync(path.dirname(fp), { recursive: true });
            fs.writeFileSync(fp, await file.buffer());
          }
        }
      } else {
        const tar = (await import('tar')).default;
        await tar.extract({ file: safePath, cwd: subDir });
      }
      results.push({ file: arc, success: true });
    } catch (err) {
      results.push({ file: arc, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { success: true, results };
}));

// ============================================================================
// SEARCH & BATCH OPERATIONS
// ============================================================================

// 14. Search files
client.registerTool({
  name: 'search_files',
  description: 'Search for files by name pattern in a directory',
  input: z.object({
    dirPath: z.string().describe('Directory to search in'),
    query: z.string().describe('Search query (supports * and ? wildcards)'),
    recursive: z.boolean().default(true).describe('Search recursively'),
    filesOnly: z.boolean().default(false).describe('Return only files'),
    limit: z.number().default(30).describe('Max results'),
  }),
}, withPathValidation(['dirPath'], async ({ dirPath, query, recursive, filesOnly, limit }) => {
  try {
    const q = (query as string).replace(/\*/g, '.*').replace(/\?/g, '.');
    const regex = new RegExp(q, 'i');
    const results: Array<{ name: string; path: string; size: number; modified: string }> = [];
    searchDir(dirPath as string, regex, recursive as boolean, filesOnly as boolean, results, limit as number);
    return { success: true, results, count: results.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Search failed: ${msg}` };
  }
}));

// ============================================================================
// Startup
// ============================================================================

export default client;

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const mode = (process.env.KADI_MODE || process.argv[2] || 'stdio') as any;

  if (mode === 'stdio') {
    console.error(`[ability-file-local] Starting in ${mode} mode...`);
  } else {
    console.log(`[ability-file-local] Starting in ${mode} mode...`);
  }

  client.serve(mode).catch((error: Error) => {
    console.error('[ability-file-local] Failed to start:', error);
    process.exit(1);
  });
}
