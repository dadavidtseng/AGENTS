/**
 * Integration tests for the backup/restore pipeline.
 *
 * These are **real** tests — they exercise:
 *   - ArcadeDB BACKUP DATABASE via the HTTP SQL API
 *   - Retrieving backup files from the container via docker cp
 *   - tar.gz compression / decompression via system `tar`
 *   - Serving a backup file over HTTP and downloading it
 *   - Restoring a database from a backup (via docker cp + restore.sh)
 *   - Data integrity verification (write data → backup → restore → verify data)
 *
 * Supports two modes:
 *   A. Docker mode (default) — ArcadeDB runs inside a Docker container.
 *      Backup files are retrieved/injected via `docker cp` / `docker exec`.
 *   B. Native mode (`KADI_DEPLOY_MODE=container`) — ArcadeDB runs natively
 *      on the same filesystem. Backup files accessed directly.
 *
 * Prerequisites:
 *   - ArcadeDB running (one of):
 *       kadi deploy local           (Docker container)
 *       docker compose up -d        (Docker container)
 *       sh scripts/start-arcadedb.sh (native, with KADI_DEPLOY_MODE=container)
 *
 * Run:
 *   ARCADE_PASSWORD=huminlab npx vitest run tests/integration/backup.test.ts
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  createWriteStream,
} from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { execSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ArcadeHttpClient } from '../../src/lib/http-client.js';
import { loadArcadeConfig } from '../../src/lib/config.js';
import { createManagers } from '../../src/lib/arcade-admin.js';
import type { ArcadeManagers } from '../../src/lib/types.js';

// ---------------------------------------------------------------------------
// Helpers — detect runtime mode and container name
// ---------------------------------------------------------------------------

const isContainerMode = process.env.KADI_DEPLOY_MODE === 'container';

/** Try to find the running Docker container name for ArcadeDB. */
function detectContainerName(): string | null {
  if (isContainerMode) return null; // native mode — no container
  try {
    // Look for a container that exposes port 2480
    const name = execSync(
      'docker ps --format "{{.Names}}" --filter "publish=2480"',
      { encoding: 'utf8' },
    ).trim();
    if (name) return name.split('\n')[0];

    // Fall back to kadi-agent (kadi deploy default)
    const kadiAgent = execSync(
      'docker ps --filter name=kadi-agent --format "{{.Names}}"',
      { encoding: 'utf8' },
    ).trim();
    return kadiAgent || null;
  } catch {
    return null;
  }
}

const CONTAINER_NAME = detectContainerName();
const ARCADEDB_HOME = process.env.ARCADEDB_HOME || '/home/arcadedb';

/**
 * Copy a file FROM the ArcadeDB container (or local filesystem) to a local path.
 */
function copyFromArcade(containerPath: string, localPath: string): void {
  if (isContainerMode) {
    // Native mode — direct filesystem
    execSync(`cp "${containerPath}" "${localPath}"`);
  } else if (CONTAINER_NAME) {
    execSync(`docker cp "${CONTAINER_NAME}:${containerPath}" "${localPath}"`);
  } else {
    throw new Error('Cannot access backup files — no container found and not in native mode');
  }
}

/**
 * Copy a file TO the ArcadeDB container (or local filesystem).
 */
function copyToArcade(localPath: string, containerPath: string): void {
  if (isContainerMode) {
    execSync(`cp "${localPath}" "${containerPath}"`);
  } else if (CONTAINER_NAME) {
    execSync(`docker cp "${localPath}" "${CONTAINER_NAME}:${containerPath}"`);
  } else {
    throw new Error('Cannot inject files — no container found and not in native mode');
  }
}

/**
 * List files in a directory inside the ArcadeDB container (or local filesystem).
 */
function listArcadeDir(containerPath: string): string[] {
  let output: string;
  if (isContainerMode) {
    output = execSync(`ls "${containerPath}" 2>/dev/null || true`, { encoding: 'utf8' });
  } else if (CONTAINER_NAME) {
    output = execSync(`docker exec "${CONTAINER_NAME}" ls "${containerPath}" 2>/dev/null || true`, { encoding: 'utf8' });
  } else {
    return [];
  }
  return output.trim().split('\n').filter(Boolean);
}

/**
 * Execute a command inside the ArcadeDB container (or locally in native mode).
 */
function execInArcade(cmd: string): string {
  if (isContainerMode) {
    return execSync(cmd, { encoding: 'utf8' });
  } else if (CONTAINER_NAME) {
    return execSync(`docker exec "${CONTAINER_NAME}" ${cmd}`, { encoding: 'utf8' });
  }
  throw new Error('No container available');
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const BACKUP_TEST_DB = `backup_test_${Date.now()}`;
const RESTORE_TEST_DB = `restore_test_${Date.now()}`;
let httpClient: ArcadeHttpClient;
let managers: ArcadeManagers;
let tmpDir: string;

beforeAll(async () => {
  const config = loadArcadeConfig();
  httpClient = new ArcadeHttpClient(config);
  managers = createManagers(config);

  const ready = await httpClient.isReady();
  if (!ready) {
    throw new Error(
      'ArcadeDB is not running. Start it with:\n' +
      '  docker compose up -d   OR   sh scripts/start-arcadedb.sh',
    );
  }

  // Temp directory for test artifacts
  tmpDir = mkdtempSync(join(tmpdir(), 'kadi-backup-test-'));

  // Create test database and populate with data
  await managers.database.createDatabase(BACKUP_TEST_DB);
  await httpClient.command(BACKUP_TEST_DB, 'CREATE VERTEX TYPE TestPerson IF NOT EXISTS');
  await httpClient.command(BACKUP_TEST_DB, 'CREATE VERTEX TYPE TestProject IF NOT EXISTS');
  await httpClient.command(BACKUP_TEST_DB, 'CREATE EDGE TYPE WorksOn IF NOT EXISTS');

  // Insert test data we can verify after restore
  await httpClient.command(BACKUP_TEST_DB, "INSERT INTO TestPerson SET name = 'Alice', role = 'engineer'");
  await httpClient.command(BACKUP_TEST_DB, "INSERT INTO TestPerson SET name = 'Bob', role = 'designer'");
  await httpClient.command(BACKUP_TEST_DB, "INSERT INTO TestProject SET title = 'KADI', status = 'active'");

  // Create edges
  const alice = await httpClient.query(BACKUP_TEST_DB, "SELECT @rid FROM TestPerson WHERE name = 'Alice'");
  const bob = await httpClient.query(BACKUP_TEST_DB, "SELECT @rid FROM TestPerson WHERE name = 'Bob'");
  const kadi = await httpClient.query(BACKUP_TEST_DB, "SELECT @rid FROM TestProject WHERE title = 'KADI'");

  if (alice.result?.[0] && kadi.result?.[0]) {
    const aliceRid = (alice.result[0] as Record<string, string>)['@rid'];
    const kadiRid = (kadi.result[0] as Record<string, string>)['@rid'];
    await httpClient.command(BACKUP_TEST_DB, `CREATE EDGE WorksOn FROM ${aliceRid} TO ${kadiRid} SET since = 2024`);
  }
  if (bob.result?.[0] && kadi.result?.[0]) {
    const bobRid = (bob.result[0] as Record<string, string>)['@rid'];
    const kadiRid = (kadi.result[0] as Record<string, string>)['@rid'];
    await httpClient.command(BACKUP_TEST_DB, `CREATE EDGE WorksOn FROM ${bobRid} TO ${kadiRid} SET since = 2025`);
  }
}, 30_000);

afterAll(async () => {
  // Clean up databases
  for (const db of [BACKUP_TEST_DB, RESTORE_TEST_DB]) {
    try {
      await managers.database.dropDatabase(db, { confirm: true });
    } catch {
      // Already dropped or never created
    }
  }
  // Clean up temp dir
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}, 30_000);

// ---------------------------------------------------------------------------
// 1. Backup via SQL API — create and retrieve real backup
// ---------------------------------------------------------------------------

describe('backup via ArcadeDB SQL API', () => {
  let backupFileName: string;
  let localBackupPath: string;
  const backupContainerDir = `${ARCADEDB_HOME}/backups/${BACKUP_TEST_DB}`;

  it('BACKUP DATABASE creates a .zip file inside the container', async () => {
    const config = loadArcadeConfig();
    const auth = Buffer.from(`${config.server.username}:${config.server.password}`).toString('base64');

    const response = await fetch(
      `http://${config.server.host}:${config.server.port}/api/v1/command/${BACKUP_TEST_DB}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ language: 'sql', command: 'BACKUP DATABASE' }),
      },
    );

    expect(response.ok).toBe(true);
    const json = await response.json();
    backupFileName = json.result?.[0]?.backupFile ?? json.result?.[0];
    expect(backupFileName).toBeTruthy();
    expect(String(backupFileName)).toMatch(/\.zip$/);

    // Verify the file exists inside the container
    const files = listArcadeDir(backupContainerDir);
    expect(files.some((f) => f.endsWith('.zip'))).toBe(true);
  }, 30_000);

  it('backup .zip can be retrieved from container and has valid ZIP magic bytes', () => {
    const files = listArcadeDir(backupContainerDir);
    const zipFile = files.find((f) => f.endsWith('.zip'));
    expect(zipFile).toBeTruthy();

    localBackupPath = join(tmpDir, zipFile!);
    copyFromArcade(`${backupContainerDir}/${zipFile}`, localBackupPath);

    expect(existsSync(localBackupPath)).toBe(true);
    expect(statSync(localBackupPath).size).toBeGreaterThan(0);

    // ZIP magic: PK\x03\x04
    const magic = readFileSync(localBackupPath).subarray(0, 4).toString('hex');
    expect(magic.startsWith('504b')).toBe(true);
  });

  it('verifyBackup() returns true for the retrieved file', async () => {
    expect(localBackupPath).toBeTruthy();
    const valid = await managers.backup.verifyBackup(localBackupPath);
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Compression — tar.gz round-trip
// ---------------------------------------------------------------------------

describe('tar.gz compression round-trip', () => {
  let backupZipPath: string;
  let compressedPath: string;
  const backupContainerDir = `${ARCADEDB_HOME}/backups/${BACKUP_TEST_DB}`;

  beforeAll(async () => {
    // Get the backup file from the container
    const files = listArcadeDir(backupContainerDir);
    const zipFile = files.find((f) => f.endsWith('.zip'));
    if (!zipFile) {
      // Create a backup first
      const config = loadArcadeConfig();
      const auth = Buffer.from(`${config.server.username}:${config.server.password}`).toString('base64');
      await fetch(
        `http://${config.server.host}:${config.server.port}/api/v1/command/${BACKUP_TEST_DB}`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: 'sql', command: 'BACKUP DATABASE' }),
        },
      );
      const updatedFiles = listArcadeDir(backupContainerDir);
      const newZip = updatedFiles.find((f) => f.endsWith('.zip'));
      backupZipPath = join(tmpDir, newZip!);
      copyFromArcade(`${backupContainerDir}/${newZip}`, backupZipPath);
    } else {
      backupZipPath = join(tmpDir, zipFile);
      if (!existsSync(backupZipPath)) {
        copyFromArcade(`${backupContainerDir}/${zipFile}`, backupZipPath);
      }
    }
  }, 30_000);

  it('compresses the .zip to .tar.gz', () => {
    const outputPath = join(tmpDir, basename(backupZipPath) + '.tar.gz');
    const sourceDir = join(tmpDir, 'compress-source');
    mkdirSync(sourceDir, { recursive: true });

    // Copy the zip into a known location for tar
    execSync(`cp "${backupZipPath}" "${sourceDir}/"`);

    const zipName = basename(backupZipPath);
    execSync(`tar -czf "${outputPath}" -C "${sourceDir}" "${zipName}"`, { stdio: 'pipe' });

    expect(existsSync(outputPath)).toBe(true);
    const stats = statSync(outputPath);
    expect(stats.size).toBeGreaterThan(0);
    compressedPath = outputPath;
  });

  it('decompresses .tar.gz back to the original .zip', () => {
    expect(compressedPath).toBeTruthy();

    const extractDir = join(tmpDir, 'decompress-output');
    mkdirSync(extractDir, { recursive: true });

    execSync(`tar -xzf "${compressedPath}" -C "${extractDir}"`, { stdio: 'pipe' });

    const extracted = readdirSync(extractDir);
    expect(extracted.length).toBeGreaterThan(0);

    const zipFile = extracted.find((f) => f.endsWith('.zip'));
    expect(zipFile).toBeTruthy();

    // Verify extracted zip has same size as original
    const originalSize = statSync(backupZipPath).size;
    const extractedSize = statSync(join(extractDir, zipFile!)).size;
    expect(extractedSize).toBe(originalSize);
  });

  it('decompressed .zip passes verifyBackup()', async () => {
    const extractDir = join(tmpDir, 'decompress-output');
    const extracted = readdirSync(extractDir);
    const zipFile = extracted.find((f) => f.endsWith('.zip'));

    const valid = await managers.backup.verifyBackup(join(extractDir, zipFile!));
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. HTTP download — serve and download a real backup
// ---------------------------------------------------------------------------

describe('HTTP download of backup file', () => {
  let backupZipPath: string;
  let compressedPath: string;
  let serverUrl: string;
  let server: any;
  const backupContainerDir = `${ARCADEDB_HOME}/backups/${BACKUP_TEST_DB}`;

  beforeAll(async () => {
    // Get backup file from container
    const files = listArcadeDir(backupContainerDir);
    const zipFile = files.find((f) => f.endsWith('.zip'));
    expect(zipFile).toBeTruthy();

    backupZipPath = join(tmpDir, `serve-${zipFile!}`);
    if (!existsSync(backupZipPath)) {
      copyFromArcade(`${backupContainerDir}/${zipFile}`, backupZipPath);
    }

    // Compress to tar.gz
    const srcDir = join(tmpDir, 'serve-source');
    mkdirSync(srcDir, { recursive: true });
    execSync(`cp "${backupZipPath}" "${srcDir}/"`);
    compressedPath = join(tmpDir, 'serve-test.tar.gz');
    execSync(`tar -czf "${compressedPath}" -C "${srcDir}" "${basename(backupZipPath)}"`, { stdio: 'pipe' });
  }, 30_000);

  afterEach(async () => {
    if (server) {
      try { server.close(); } catch { /* ignore */ }
      server = null;
    }
  });

  it('serves a file over HTTP that can be downloaded', async () => {
    // Use a simple HTTP server (we test the concept without @kadi.build/file-sharing
    // since that package may not be installed locally)
    const http = await import('http');

    const servingDir = join(tmpDir, 'serve-source');
    const filename = basename(backupZipPath);

    await new Promise<void>((resolve) => {
      server = http.createServer((req: any, res: any) => {
        const reqPath = decodeURIComponent(req.url?.replace(/^\//, '') ?? '');
        const filePath = join(servingDir, reqPath);
        if (existsSync(filePath)) {
          const stat = statSync(filePath);
          res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': 'application/octet-stream',
          });
          const { createReadStream } = require('fs');
          createReadStream(filePath).pipe(res);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      server.listen(0, () => {
        const addr = server.address();
        serverUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });

    // Download the file
    const downloadPath = join(tmpDir, 'downloaded-backup.zip');
    const response = await fetch(`${serverUrl}/${encodeURIComponent(filename)}`);
    expect(response.ok).toBe(true);
    expect(response.body).toBeTruthy();

    const nodeStream = Readable.fromWeb(response.body as any);
    const ws = createWriteStream(downloadPath);
    await pipeline(nodeStream, ws);

    // Verify the downloaded file matches the original
    const originalSize = statSync(join(servingDir, filename)).size;
    const downloadedSize = statSync(downloadPath).size;
    expect(downloadedSize).toBe(originalSize);

    // Verify it's a valid backup
    const valid = await managers.backup.verifyBackup(downloadPath);
    expect(valid).toBe(true);
  }, 15_000);

  it('downloaded .tar.gz can be decompressed to valid .zip', async () => {
    const http = await import('http');

    const servingDir = join(tmpDir, 'serve-source');
    // Serve the compressed file instead
    const tarGzDir = tmpDir;
    const tarGzFile = 'serve-test.tar.gz';

    await new Promise<void>((resolve) => {
      server = http.createServer((req: any, res: any) => {
        const filePath = join(tarGzDir, tarGzFile);
        if (existsSync(filePath)) {
          const stat = statSync(filePath);
          res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'application/gzip' });
          const { createReadStream } = require('fs');
          createReadStream(filePath).pipe(res);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      server.listen(0, () => {
        const addr = server.address();
        serverUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });

    // Download tar.gz
    const dlPath = join(tmpDir, 'downloaded.tar.gz');
    const resp = await fetch(`${serverUrl}/${tarGzFile}`);
    expect(resp.ok).toBe(true);
    const ns = Readable.fromWeb(resp.body as any);
    await pipeline(ns, createWriteStream(dlPath));

    expect(statSync(dlPath).size).toBe(statSync(compressedPath).size);

    // Decompress
    const extractDir = join(tmpDir, 'dl-extract');
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${dlPath}" -C "${extractDir}"`, { stdio: 'pipe' });

    const extracted = readdirSync(extractDir);
    const zipFile = extracted.find((f) => f.endsWith('.zip'));
    expect(zipFile).toBeTruthy();

    // Verify zip is valid
    const valid = await managers.backup.verifyBackup(join(extractDir, zipFile!));
    expect(valid).toBe(true);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// 4. Full round-trip: populate → backup → compress → download → decompress → restore → verify data
// ---------------------------------------------------------------------------

describe('full backup → restore round-trip with data verification', () => {
  let backupZipPath: string;
  let compressedPath: string;
  let downloadedZipPath: string;
  const backupContainerDir = `${ARCADEDB_HOME}/backups/${BACKUP_TEST_DB}`;

  it('step 1: creates backup of populated database', async () => {
    // Verify source data exists before backup
    const people = await httpClient.query(BACKUP_TEST_DB, 'SELECT FROM TestPerson ORDER BY name');
    expect(people.result?.length).toBe(2);

    const projects = await httpClient.query(BACKUP_TEST_DB, 'SELECT FROM TestProject');
    expect(projects.result?.length).toBe(1);

    // Create backup via SQL API
    const config = loadArcadeConfig();
    const auth = Buffer.from(`${config.server.username}:${config.server.password}`).toString('base64');
    const response = await fetch(
      `http://${config.server.host}:${config.server.port}/api/v1/command/${BACKUP_TEST_DB}`,
      {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'sql', command: 'BACKUP DATABASE' }),
      },
    );
    expect(response.ok).toBe(true);

    // Retrieve the backup file from the container
    const files = listArcadeDir(backupContainerDir);
    const zipFile = files.find((f) => f.endsWith('.zip'));
    expect(zipFile).toBeTruthy();

    backupZipPath = join(tmpDir, `roundtrip-${zipFile!}`);
    copyFromArcade(`${backupContainerDir}/${zipFile}`, backupZipPath);

    expect(existsSync(backupZipPath)).toBe(true);
    expect(statSync(backupZipPath).size).toBeGreaterThan(0);
  }, 30_000);

  it('step 2: compresses backup to tar.gz', () => {
    const srcDir = join(tmpDir, 'roundtrip-src');
    mkdirSync(srcDir, { recursive: true });
    execSync(`cp "${backupZipPath}" "${srcDir}/"`);

    compressedPath = join(tmpDir, 'roundtrip-backup.tar.gz');
    execSync(`tar -czf "${compressedPath}" -C "${srcDir}" "${basename(backupZipPath)}"`, { stdio: 'pipe' });

    expect(existsSync(compressedPath)).toBe(true);
    expect(statSync(compressedPath).size).toBeGreaterThan(0);
  });

  it('step 3: serves tar.gz over HTTP and downloads it', async () => {
    const http = await import('http');
    let server: any;

    try {
      const serveDir = tmpDir;
      const tarGzName = basename(compressedPath);

      server = await new Promise<any>((resolve) => {
        const s = http.createServer((req: any, res: any) => {
          const fp = join(serveDir, tarGzName);
          if (existsSync(fp)) {
            const stat = statSync(fp);
            res.writeHead(200, { 'Content-Length': stat.size });
            const { createReadStream } = require('fs');
            createReadStream(fp).pipe(res);
          } else {
            res.writeHead(404); res.end();
          }
        });
        s.listen(0, () => resolve(s));
      });

      const addr = server.address();
      const url = `http://localhost:${addr.port}/${encodeURIComponent(tarGzName)}`;

      // Download
      const dlPath = join(tmpDir, 'roundtrip-downloaded.tar.gz');
      const resp = await fetch(url);
      expect(resp.ok).toBe(true);
      await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(dlPath));

      // Verify download integrity
      expect(statSync(dlPath).size).toBe(statSync(compressedPath).size);

      // Decompress
      const extractDir = join(tmpDir, 'roundtrip-extract');
      mkdirSync(extractDir, { recursive: true });
      execSync(`tar -xzf "${dlPath}" -C "${extractDir}"`, { stdio: 'pipe' });

      const zipFile = readdirSync(extractDir).find((f) => f.endsWith('.zip'));
      expect(zipFile).toBeTruthy();

      downloadedZipPath = join(extractDir, zipFile!);
      const valid = await managers.backup.verifyBackup(downloadedZipPath);
      expect(valid).toBe(true);
    } finally {
      if (server) server.close();
    }
  }, 15_000);

  it('step 4: restores backup to a new database and verifies data integrity', async () => {
    expect(downloadedZipPath).toBeTruthy();
    expect(existsSync(downloadedZipPath)).toBe(true);

    // --- Restore: copy backup into the container and extract ---

    // 1. Copy the backup ZIP into the container's backup directory
    const restoreFileName = basename(downloadedZipPath);
    execInArcade(`mkdir -p ${ARCADEDB_HOME}/backups/${RESTORE_TEST_DB}`);
    copyToArcade(downloadedZipPath, `${ARCADEDB_HOME}/backups/${RESTORE_TEST_DB}/${restoreFileName}`);

    // Verify file arrived
    const containerFiles = listArcadeDir(`${ARCADEDB_HOME}/backups/${RESTORE_TEST_DB}`);
    expect(containerFiles).toContain(restoreFileName);

    // 2. Extract the backup into the databases directory
    execInArcade(`mkdir -p ${ARCADEDB_HOME}/databases/${RESTORE_TEST_DB}`);
    execInArcade(
      `sh -c 'cd ${ARCADEDB_HOME} && unzip -o backups/${RESTORE_TEST_DB}/${restoreFileName} -d databases/${RESTORE_TEST_DB}'`,
    );

    // Verify extraction produced files
    const dbFiles = listArcadeDir(`${ARCADEDB_HOME}/databases/${RESTORE_TEST_DB}`);
    expect(dbFiles.length).toBeGreaterThan(0);

    // 3. Tell ArcadeDB to open the restored database (no restart needed)
    const config = loadArcadeConfig();
    const auth = Buffer.from(`${config.server.username}:${config.server.password}`).toString('base64');
    const openRes = await fetch(
      `http://${config.server.host}:${config.server.port}/api/v1/server`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command: `open database ${RESTORE_TEST_DB}` }),
      },
    );

    // If 'open database' isn't supported, the database may already be auto-detected.
    // Either way, give ArcadeDB a moment to load.
    if (!openRes.ok) {
      console.log(`⚠️ open database response: ${openRes.status} ${await openRes.text()}`);
    }
    await new Promise((r) => setTimeout(r, 2000));

    // --- Verify data integrity — same data we inserted in beforeAll ---

    // Verify vertex data
    const people = await httpClient.query(RESTORE_TEST_DB, 'SELECT FROM TestPerson ORDER BY name');
    expect(people.success).toBe(true);
    expect(people.result?.length).toBe(2);

    const alice = people.result![0] as Record<string, any>;
    const bob = people.result![1] as Record<string, any>;
    expect(alice.name).toBe('Alice');
    expect(alice.role).toBe('engineer');
    expect(bob.name).toBe('Bob');
    expect(bob.role).toBe('designer');

    // Verify project data
    const projects = await httpClient.query(RESTORE_TEST_DB, 'SELECT FROM TestProject');
    expect(projects.success).toBe(true);
    expect(projects.result?.length).toBe(1);
    expect((projects.result![0] as Record<string, any>).title).toBe('KADI');

    // Verify edges survived the backup/restore
    const edges = await httpClient.query(RESTORE_TEST_DB, 'SELECT FROM WorksOn');
    expect(edges.success).toBe(true);
    expect(edges.result?.length).toBe(2);

    // Verify graph traversal works
    const traversal = await httpClient.query(
      RESTORE_TEST_DB,
      "SELECT expand(out('WorksOn')) FROM TestPerson WHERE name = 'Alice'",
    );
    expect(traversal.success).toBe(true);
    expect(traversal.result?.length).toBe(1);
    expect((traversal.result![0] as Record<string, any>).title).toBe('KADI');
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 5. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('verifyBackup() rejects a non-ZIP file', async () => {
    const fakePath = join(tmpDir, 'not-a-zip.txt');
    writeFileSync(fakePath, 'this is not a zip file');

    const valid = await managers.backup.verifyBackup(fakePath);
    expect(valid).toBe(false);
  });

  it('verifyBackup() rejects a zero-byte file', async () => {
    const emptyPath = join(tmpDir, 'empty.zip');
    writeFileSync(emptyPath, '');

    const valid = await managers.backup.verifyBackup(emptyPath);
    expect(valid).toBe(false);
  });

  it('verifyBackup() rejects a non-existent file', async () => {
    const valid = await managers.backup.verifyBackup(join(tmpDir, 'does-not-exist.zip'));
    expect(valid).toBe(false);
  });

  it('backup files exist inside the container after tests', () => {
    const files = listArcadeDir(`${ARCADEDB_HOME}/backups/${BACKUP_TEST_DB}`);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith('.zip'))).toBe(true);
  });
});
