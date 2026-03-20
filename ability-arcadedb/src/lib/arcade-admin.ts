/**
 * Loads the five CJS manager classes from the colocated lib/ directory and
 * instantiates them with the provided ArcadeDB configuration.
 *
 * Each manager wraps a different aspect of ArcadeDB administration:
 *   - ContainerManager   -- Docker lifecycle (start/stop/status)
 *   - DatabaseManager    -- Database CRUD and schema inspection
 *   - BackupManager      -- Backup creation, restore, and retention
 *   - ImportExportManager -- Data import/export (JSON, CSV, TSV)
 *   - MonitoringManager  -- Health checks, metrics, diagnostics
 */

import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import type {
  ArcadeConfig,
  ArcadeManagers,
  IBackupManager,
  IContainerManager,
  IDatabaseManager,
  IImportExportManager,
  IMonitoringManager,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve lib/ relative to compiled output (dist/lib/ -> lib/)
const libDir = join(__dirname, '..', '..', 'lib');

const ContainerManager = require(join(libDir, 'container.js'));
const DatabaseManager = require(join(libDir, 'database.js'));
const BackupManager = require(join(libDir, 'backup.js'));
const ImportExportManager = require(join(libDir, 'import-export.js'));
const MonitoringManager = require(join(libDir, 'monitoring.js'));

/**
 * Create typed instances of all five ArcadeDB administration managers.
 *
 * The underlying implementations are plain-JS CJS classes loaded at runtime.
 * The returned object is typed via the `ArcadeManagers` interface so that
 * callers get full IntelliSense without touching the vendored source.
 */
export function createManagers(config: ArcadeConfig): ArcadeManagers {
  return {
    container: new ContainerManager(config) as IContainerManager,
    database: new DatabaseManager(config) as IDatabaseManager,
    backup: new BackupManager(config) as IBackupManager,
    importExport: new ImportExportManager(config) as IImportExportManager,
    monitoring: new MonitoringManager(config) as IMonitoringManager,
  };
}
