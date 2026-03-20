// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/** Connection settings for the ArcadeDB server. */
export interface ArcadeServerConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  container_name: string;
}

/** Paths for persistent data and backups. */
export interface ArcadeStorageConfig {
  data_dir: string;
  backup_dir: string;
}

/** Operational defaults (retention, log depth, etc.). */
export interface ArcadeDefaultsConfig {
  backup_retention_days: number;
  log_lines: number;
}

/** Top-level configuration loaded from config.yml / env vars. */
export interface ArcadeConfig {
  server: ArcadeServerConfig;
  storage: ArcadeStorageConfig;
  defaults: ArcadeDefaultsConfig;
}

// ---------------------------------------------------------------------------
// HTTP client result types
// ---------------------------------------------------------------------------

/** Result of a single SQL query or command executed via the HTTP API. */
export interface QueryResult {
  success: boolean;
  result?: unknown[];
  count?: number;
  error?: string;
}

/** Result of a transactional batch of commands. */
export interface BatchResult {
  success: boolean;
  results?: unknown[];
  committed?: boolean;
  error?: string;
}

/**
 * A single item in a batch — either a plain SQL string or an object
 * containing a parameterized command.
 *
 * When a plain string is provided, it is executed as-is.  When an object
 * is provided, `command` is the SQL text (with `:paramName` placeholders)
 * and `params` carries the bindings.  This lets callers avoid SQL-escaping
 * string values that contain quotes, newlines, or other special characters.
 */
export type BatchCommand =
  | string
  | { command: string; params?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Container manager types (mirrors lib/container.js public API)
// ---------------------------------------------------------------------------

export interface ContainerStartOptions {
  withTestData?: boolean;
  restart?: boolean;
}

export interface ContainerStopOptions {
  force?: boolean;
}

export interface ContainerStatusInfo {
  container: {
    running: boolean;
    status: string;
    name?: string;
    uptime: string | null;
    ports?: string[];
  };
  server: {
    ready: boolean;
    accessible: boolean;
  };
  storage: {
    dataDir: string;
    exists: boolean;
  };
}

export interface ResourceUsage {
  cpu: string;
  memoryUsage: string;
  memoryPercent: string;
  networkIO: string;
  blockIO: string;
}

export interface ContainerHealthCheck {
  overall: string;
  checks: {
    containerRunning: boolean;
    serverReady: boolean;
    dataDirectoryExists: boolean;
    memoryOk: boolean;
  };
}

/** Public surface of the vendored ContainerManager (lib/container.js). */
export interface IContainerManager {
  start(options?: ContainerStartOptions): Promise<boolean>;
  stop(options?: ContainerStopOptions): Promise<boolean>;
  restart(options?: ContainerStartOptions): Promise<boolean>;
  getStatus(): Promise<ContainerStatusInfo>;
  isRunning(): Promise<boolean>;
  isReady(): Promise<boolean>;
  getLogs(lines?: number): string;
  getResourceUsage(): ResourceUsage | null;
  healthCheck(): Promise<ContainerHealthCheck>;
  cleanup(): void;
}

// ---------------------------------------------------------------------------
// Database manager types (mirrors lib/database.js public API)
// ---------------------------------------------------------------------------

export interface DatabaseSchemaInfo {
  types: number | string;
  indexes: number | string;
  details?: {
    typeList: string[];
    indexList: string[];
  };
  error?: string;
}

export interface DatabaseStats {
  recordCount: number | string;
  typeCount: number | string;
  error?: string;
}

export interface DatabaseFileInfo {
  exists: boolean;
  size: number;
  sizeFormatted: string;
  path?: string;
  fileCount?: number;
  files?: Array<{ name: string; size: number; modified: Date }>;
  error?: string;
}

export interface DatabaseInfo {
  name: string;
  schema: DatabaseSchemaInfo;
  statistics: DatabaseStats;
  files: DatabaseFileInfo;
  serverInfo: {
    host: string;
    port: number;
    accessible: boolean;
  };
}

export interface DatabaseStatsEntry {
  name: string;
  size: number;
  sizeFormatted: string;
  recordCount: number | string;
  typeCount: number | string;
  error?: string;
}

export interface AllDatabaseStats {
  totalDatabases: number;
  databases: DatabaseStatsEntry[];
  totalSize: number;
  totalSizeFormatted: string;
}

/** Public surface of the vendored DatabaseManager (lib/database.js). */
export interface IDatabaseManager {
  listDatabases(): Promise<string[]>;
  createDatabase(name: string, options?: { schema?: string | null }): Promise<boolean>;
  dropDatabase(name: string, options?: { confirm?: boolean }): Promise<boolean>;
  getDatabaseInfo(name: string): Promise<DatabaseInfo>;
  getDatabaseUsers(name: string): Promise<Array<{ name: string; type: string; note: string }>>;
  checkDatabaseHealth(name: string): Promise<{
    name: string;
    accessible: boolean;
    responsive: boolean;
    fileSystemOk: boolean;
    overall: string;
    errors: string[];
  }>;
  getDatabaseStats(): Promise<AllDatabaseStats>;
}

// ---------------------------------------------------------------------------
// Backup manager types (mirrors lib/backup.js public API)
// ---------------------------------------------------------------------------

export interface BackupInfo {
  database: string;
  fileName: string;
  fullPath: string;
  size: number;
  sizeFormatted: string;
  created: Date;
  age: string;
}

/** Public surface of the vendored BackupManager (lib/backup.js). */
export interface IBackupManager {
  createBackup(database: string, options?: { verify?: boolean }): Promise<BackupInfo>;
  restoreBackup(database: string, backupFilePath: string, options?: { overwrite?: boolean }): Promise<boolean>;
  listBackups(options?: { database?: string | null }): BackupInfo[];
  verifyBackup(backupFilePath: string): Promise<boolean>;
  cleanupOldBackups(options?: { olderThanDays?: number; dryRun?: boolean }): BackupInfo[];
}

// ---------------------------------------------------------------------------
// Import/Export manager types (mirrors lib/import-export.js public API)
// ---------------------------------------------------------------------------

export type DataFormat = 'json' | 'csv' | 'tsv';

export interface ImportOptions {
  format?: DataFormat;
  type?: string;
  createType?: boolean;
  batchSize?: number;
}

export interface ImportStats {
  totalRecords: number;
  recordsImported: number;
  recordsFailed: number;
  batchCount: number;
  errors: string[];
  /** Alias used by some callers. */
  imported?: number;
}

export interface ExportOptions {
  format?: DataFormat;
  query?: string;
  type?: string;
  includeEdges?: boolean;
}

export interface ExportStats {
  recordsExported: number;
  fileSize: number;
  fileSizeFormatted: string;
  filePath: string;
  /** Alias used by some callers. */
  outputPath?: string;
  /** Alias used by some callers. */
  exported?: number;
  created: Date;
}

/** Public surface of the vendored ImportExportManager (lib/import-export.js). */
export interface IImportExportManager {
  importData(database: string, filePath: string, options?: ImportOptions): Promise<ImportStats>;
  exportData(database: string, outputPath: string, options?: ExportOptions): Promise<ExportStats>;
  getSupportedFormats(): {
    import: DataFormat[];
    export: DataFormat[];
    description: Record<DataFormat, string>;
  };
  validateImportFile(filePath: string): Promise<{
    exists: boolean;
    readable: boolean;
    format: DataFormat | null;
    recordCount: number;
    sampleData: unknown[] | null;
    errors: string[];
    warnings: string[];
    valid?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Monitoring manager types (mirrors lib/monitoring.js public API)
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  timestamp: string;
  overall: string;
  score: number;
  maxScore: number;
  percentage?: number;
  checks: Record<string, {
    score: number;
    maxScore: number;
    details: Record<string, string | number>;
  }>;
  warnings: string[];
  errors: string[];
  recommendations: string[];
}

export interface LogInfo {
  totalLines: number;
  filteredLines: number;
  logs: string[];
  retrievedAt: string;
  options: { lines?: number; since?: string | null; level?: string | null };
}

export interface PerformanceMetrics {
  timestamp: string;
  container: { running: boolean; cpu?: string; memory?: string; networkIO?: string };
  server: { accessible: boolean; ready?: boolean; responseTime?: number };
  database: { count: number; list?: string[]; error?: string };
  system: { dataDirSize?: string; availableSpace?: string; usedSpacePercent?: number };
}

export interface MonitoringReport {
  startTime: Date;
  endTime: Date | null;
  duration: number;
  interval: number;
  snapshots: Array<{
    timestamp: string;
    container: boolean;
    server: boolean;
    resources: ResourceUsage | null;
    responseTime: number;
  }>;
  summary: {
    totalSnapshots: number;
    containerUptime: number;
    serverUptime: number;
    avgResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
    containerUptimePercent: number;
    serverUptimePercent: number;
    trends: Record<string, unknown>;
  };
}

export interface DiagnosticIssue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  recommendation: string;
}

export interface DiagnosticReport {
  timestamp: string;
  issues: DiagnosticIssue[];
  recommendations: string[];
  warnings: string[];
  systemInfo: Record<string, unknown>;
}

export interface SystemStatus {
  timestamp: string;
  container: { running: boolean; status: string; uptime: string | null };
  server: { accessible: boolean; ready: boolean; version: string | null };
  databases: { count: number; list: string[] };
  storage: { dataDir: string; exists: boolean; size: number; sizeFormatted?: string };
  lastCheck: string;
}

/** Public surface of the vendored MonitoringManager (lib/monitoring.js). */
export interface IMonitoringManager {
  performHealthCheck(): Promise<HealthCheckResult>;
  getLogs(options?: { lines?: number; since?: string | null; level?: string | null }): Promise<LogInfo>;
  getMetrics(): Promise<PerformanceMetrics>;
  monitorSystem(options?: { duration?: number; interval?: number }): Promise<MonitoringReport>;
  runDiagnostics(): Promise<DiagnosticReport>;
  getStatus(): Promise<SystemStatus>;
}

// ---------------------------------------------------------------------------
// Aggregate managers container
// ---------------------------------------------------------------------------

/** All five vendored CJS managers, properly typed. */
export interface ArcadeManagers {
  container: IContainerManager;
  database: IDatabaseManager;
  backup: IBackupManager;
  importExport: IImportExportManager;
  monitoring: IMonitoringManager;
}

// ---------------------------------------------------------------------------
// Tool response types
// ---------------------------------------------------------------------------

/** Base shape shared by all tool responses. */
interface ToolResponseBase {
  success?: boolean;
  error?: string;
}

/** arcade-start response. */
export interface StartResponse extends ToolResponseBase {
  container?: string;
  ports?: string[];
}

/** arcade-stop response. */
export interface StopResponse extends ToolResponseBase {}

/** arcade-status response. */
export interface StatusResponse extends ToolResponseBase {
  running: boolean;
  container?: string;
  uptime?: string | null;
  ports?: string[];
}

/** arcade-health response. */
export interface HealthResponse extends ToolResponseBase {
  healthy?: boolean;
  checks?: {
    container: boolean;
    api: boolean;
    database: boolean;
  };
}

/** arcade-db-create response. */
export interface DbCreateResponse extends ToolResponseBase {
  database?: string;
}

/** arcade-db-list response. */
export interface DbListResponse extends ToolResponseBase {
  databases?: string[];
}

/** arcade-db-info response (spread from DatabaseInfo). */
export type DbInfoResponse = ToolResponseBase & Partial<DatabaseInfo>;

/** arcade-db-drop response. */
export interface DbDropResponse extends ToolResponseBase {
  hint?: string;
}

/** arcade-db-stats response (spread from AllDatabaseStats). */
export type DbStatsResponse = ToolResponseBase & Partial<AllDatabaseStats>;

/** arcade-import response. */
export interface ImportResponse extends ToolResponseBase {
  imported?: number;
}

/** arcade-export response. */
export interface ExportResponse extends ToolResponseBase {
  exported?: number;
  data?: string;
}
