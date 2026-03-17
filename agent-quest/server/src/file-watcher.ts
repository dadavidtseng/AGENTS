/**
 * File Watcher — monitors .quest-data/ directory for changes and broadcasts
 * WebSocket events to connected dashboard clients.
 *
 * Uses chokidar for cross-platform file watching with debouncing to handle
 * rapid successive writes (e.g., quest creation writes multiple files).
 */

import { watch, type FSWatcher } from 'chokidar';
import { readFile } from 'fs/promises';
import path from 'path';
import { broadcastEvent, type WsEventName } from './websocket.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Recognized file types within a quest directory. */
type QuestFileType =
  | 'metadata'
  | 'tasks'
  | 'approval-history'
  | 'requirements'
  | 'design';

/** Parsed info from a changed file path. */
interface ParsedQuestFile {
  questId: string;
  fileType: QuestFileType;
  filePath: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Debounce window (ms) to coalesce rapid file changes. */
const DEBOUNCE_MS = 300;

/**
 * Map file types to the WebSocket event they should trigger.
 * Multiple file types can map to the same event.
 */
const FILE_TYPE_TO_EVENT: Record<QuestFileType, WsEventName> = {
  metadata: 'quest.updated',
  tasks: 'task.completed',       // Generic task change event
  'approval-history': 'approval.requested',
  requirements: 'quest.updated',
  design: 'quest.updated',
};

/**
 * Map file basenames to their QuestFileType.
 */
const BASENAME_TO_TYPE: Record<string, QuestFileType> = {
  'metadata.json': 'metadata',
  'tasks.json': 'tasks',
  'approval-history.json': 'approval-history',
  'requirements.md': 'requirements',
  'design.md': 'design',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let watcher: FSWatcher | null = null;

/**
 * Pending debounce timers keyed by questId.
 * Coalesces multiple file changes within the same quest directory.
 */
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start watching the quest data directory for file changes.
 * Broadcasts WebSocket events when quest/task/approval files are modified.
 *
 * @param questDataPath - Absolute path to the .quest-data directory
 * @returns Cleanup function to stop watching
 */
export function startFileWatcher(questDataPath: string): () => Promise<void> {
  if (watcher) {
    console.warn('[file-watcher] Already running, ignoring duplicate start');
    return () => stopFileWatcher();
  }

  const watchPath = path.join(questDataPath, 'quests');
  console.log(`[file-watcher] Watching ${watchPath}`);

  watcher = watch(watchPath, {
    persistent: true,
    ignoreInitial: true,
    // Ignore .git directory inside quest-data
    ignored: /(^|[\\/\\])\.git([\\/\\]|$)/,
    // Wait for writes to finish before emitting
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  watcher
    .on('add', (filePath) => handleFileChange('add', filePath))
    .on('change', (filePath) => handleFileChange('change', filePath))
    .on('unlink', (filePath) => handleFileChange('unlink', filePath))
    .on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[file-watcher] Error:', msg);
    })
    .on('ready', () => {
      console.log('[file-watcher] Ready and watching for changes');
    });

  return () => stopFileWatcher();
}

/**
 * Stop the file watcher and clean up all pending timers.
 */
export async function stopFileWatcher(): Promise<void> {
  // Clear all pending debounce timers
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();

  if (watcher) {
    await watcher.close();
    watcher = null;
    console.log('[file-watcher] Stopped');
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Handle a file system change event.
 * Parses the file path, debounces by questId, then broadcasts.
 */
function handleFileChange(
  eventType: 'add' | 'change' | 'unlink',
  filePath: string,
): void {
  const parsed = parseQuestFilePath(filePath);
  if (!parsed) return; // Not a recognized quest file

  console.log(
    `[file-watcher] ${eventType}: ${parsed.fileType} for quest ${parsed.questId}`,
  );

  // Debounce: coalesce rapid changes for the same quest
  const key = `${parsed.questId}:${parsed.fileType}`;
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);

  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      processFileChange(eventType, parsed);
    }, DEBOUNCE_MS),
  );
}

/**
 * Process a debounced file change: read the file and broadcast event.
 */
async function processFileChange(
  eventType: 'add' | 'change' | 'unlink',
  parsed: ParsedQuestFile,
): Promise<void> {
  const wsEvent = FILE_TYPE_TO_EVENT[parsed.fileType];

  // For deletions, broadcast with minimal data
  if (eventType === 'unlink') {
    broadcastEvent(wsEvent, {
      questId: parsed.questId,
      fileType: parsed.fileType,
      action: 'deleted',
    });
    return;
  }

  // Read and parse the changed file
  try {
    const content = await readFile(parsed.filePath, 'utf-8');
    const data = parseFileContent(parsed.fileType, content);

    broadcastEvent(wsEvent, {
      questId: parsed.questId,
      fileType: parsed.fileType,
      action: eventType === 'add' ? 'created' : 'updated',
      ...data,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(
      `[file-watcher] Failed to read ${parsed.filePath}: ${msg}`,
    );
  }
}

/**
 * Parse a file path to extract questId and file type.
 *
 * Expected path pattern:
 *   {questDataPath}/quests/{questId}/{filename}
 *
 * Returns null if the path doesn't match a recognized pattern.
 */
function parseQuestFilePath(filePath: string): ParsedQuestFile | null {
  // Normalize to forward slashes for consistent parsing
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');

  // Find the "quests" segment and extract questId + filename
  const questsIdx = parts.lastIndexOf('quests');
  if (questsIdx === -1 || questsIdx + 2 >= parts.length) return null;

  const questId = parts[questsIdx + 1];
  const filename = parts[questsIdx + 2];

  // Only handle files directly inside the quest directory (not nested)
  if (parts.length > questsIdx + 3) return null;

  const fileType = BASENAME_TO_TYPE[filename];
  if (!fileType) return null;

  return { questId, fileType, filePath };
}

/**
 * Parse file content based on file type.
 * JSON files are parsed; markdown files return raw content.
 */
function parseFileContent(
  fileType: QuestFileType,
  content: string,
): Record<string, unknown> {
  switch (fileType) {
    case 'metadata':
      return { quest: JSON.parse(content) };

    case 'tasks':
      return { tasks: JSON.parse(content) };

    case 'approval-history':
      return { approvals: JSON.parse(content) };

    case 'requirements':
    case 'design':
      return { document: content };
  }
}
