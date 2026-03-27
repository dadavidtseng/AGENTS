/**
 * Shared types for backup-ability.
 *
 * @module types
 */

// ── Transfer mode ─────────────────────────────────────────────────────

/** Which transfer path was used for cloud operations. */
export type TransferMode = 'local' | 'distributed';

// ── Step timing ───────────────────────────────────────────────────────

/** Timing info for a single pipeline step. */
export interface StepTiming {
  durationMs: number;
}

// ── Backup pipeline ───────────────────────────────────────────────────

export interface BackupStepResult extends StepTiming {
  path: string;
  size?: number;
}

export interface CompressStepResult extends StepTiming {
  path: string;
  size?: number;
  ratio?: number;
}

export interface UploadStepResult extends StepTiming {
  remotePath: string;
  provider: string;
  mode: TransferMode;
}

export interface CleanupStepResult {
  removed: boolean;
}

export interface BackupResult {
  success: boolean;
  database?: string;
  totalDurationMs?: number;
  transferMode?: TransferMode;
  remotePath?: string;
  steps?: {
    backup?: BackupStepResult;
    compress?: CompressStepResult;
    upload?: UploadStepResult;
    cleanup?: CleanupStepResult;
  };
  /** Present when pipeline fails partway through. */
  failedAt?: 'backup' | 'compress' | 'upload' | 'cleanup';
  error?: string;
  partialResult?: Record<string, any>;
}

// ── Restore pipeline ──────────────────────────────────────────────────

export interface DownloadStepResult extends StepTiming {
  localPath: string;
  provider: string;
  mode: TransferMode;
}

export interface DecompressStepResult extends StepTiming {
  path: string;
  extractedFiles?: number;
}

export interface RestoreStepResult extends StepTiming {
  database: string;
}

export interface RestoreResult {
  success: boolean;
  database?: string;
  source?: string;
  provider?: string;
  totalDurationMs?: number;
  transferMode?: TransferMode;
  steps?: {
    download?: DownloadStepResult;
    decompress?: DecompressStepResult;
    restore?: RestoreStepResult;
  };
  failedAt?: 'download' | 'decompress' | 'restore';
  error?: string;
  partialResult?: Record<string, any>;
}

// ── Schedule ──────────────────────────────────────────────────────────

export interface ScheduleConfig {
  database: string;
  provider: string;
  intervalHours: number;
}

export interface ScheduleEntry {
  scheduleId: string;
  database: string;
  provider: string;
  intervalHours: number;
  status: 'active' | 'removed';
  nextRun: string;   // ISO timestamp
  lastRun?: string;  // ISO timestamp
  lastResult?: BackupResult;
}

// ── Status ────────────────────────────────────────────────────────────

export interface BackupStatusResult {
  success: boolean;
  schedules: ScheduleEntry[];
  recentBackups: Array<{
    path: string;
    size?: number;
    modified?: string;
  }>;
  config: {
    defaultProvider: string;
    cloudBasePath: string;
    compressionFormat: string;
    retentionCount: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Build a standardised remote path for a backup.
 *
 * Format: `/kadi-backups/{database}/{timestamp}.tar.gz`
 */
export function buildRemotePath(database: string, timestamp?: Date): string {
  const ts = (timestamp ?? new Date())
    .toISOString()
    .replace(/[:.]/g, '-'); // filesystem-safe
  return `/kadi-backups/${database}/${ts}.tar.gz`;
}

/**
 * Check if an error is a "file not found" type error.
 *
 * Used to detect that cloud-storage-ability cannot see the local file
 * (because it's on a different machine), triggering the distributed
 * fallback path.
 */
export function isFileNotFoundError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('enoent') ||
      msg.includes('no such file') ||
      msg.includes('file not found') ||
      msg.includes('not found') ||
      msg.includes('does not exist') ||
      msg.includes('path not found')
    );
  }
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, any>;
    if (obj.code === 'ENOENT') return true;
    if (obj.error && typeof obj.error === 'string') {
      const msg = obj.error.toLowerCase();
      return (
        msg.includes('enoent') ||
        msg.includes('no such file') ||
        msg.includes('file not found') ||
        msg.includes('not found') ||
        msg.includes('does not exist')
      );
    }
  }
  return false;
}

/**
 * Measure the duration of an async operation in milliseconds.
 */
export async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = Math.round(performance.now() - start);
  return { result, durationMs };
}
