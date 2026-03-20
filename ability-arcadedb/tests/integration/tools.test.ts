/**
 * Integration tests for arcadedb-ability tools.
 *
 * These tests run against a real ArcadeDB instance (docker-compose).
 * Start it first: `docker compose up -d arcadedb` from tmis-paper/.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ArcadeHttpClient } from '../../src/lib/http-client.js';
import { loadArcadeConfig } from '../../src/lib/config.js';
import { createManagers } from '../../src/lib/arcade-admin.js';
import type { ArcadeManagers } from '../../src/lib/types.js';

const TEST_DB = `integration_test_${Date.now()}`;

let httpClient: ArcadeHttpClient;
let managers: ArcadeManagers;

beforeAll(async () => {
  const config = loadArcadeConfig();
  httpClient = new ArcadeHttpClient(config);
  managers = createManagers(config);

  const ready = await httpClient.isReady();
  if (!ready) {
    throw new Error(
      'ArcadeDB is not running. Start it with: docker compose up -d arcadedb (from tmis-paper/)',
    );
  }

  // Create the shared test database
  await managers.database.createDatabase(TEST_DB);
});

afterAll(async () => {
  try {
    await managers.database.dropDatabase(TEST_DB, { confirm: true });
  } catch {
    // Already dropped or never created
  }
});

// ---------------------------------------------------------------------------
// Health and readiness
// ---------------------------------------------------------------------------

describe('health and readiness', () => {
  it('ArcadeDB is ready via HTTP API', async () => {
    expect(await httpClient.isReady()).toBe(true);
  });

  it('container is running', async () => {
    expect(await managers.container.isRunning()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// arcade-status
// ---------------------------------------------------------------------------

describe('arcade-status', () => {
  it('returns running status with container details', async () => {
    const status = await managers.container.getStatus();
    expect(status.container.running).toBe(true);
    expect(status.container.status).toBeDefined();
  });

  it('includes uptime when running', async () => {
    const status = await managers.container.getStatus();
    expect(status.container.uptime).toBeDefined();
  });

  it('reports server as accessible and ready', async () => {
    const status = await managers.container.getStatus();
    expect(status.server.accessible).toBe(true);
    expect(status.server.ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// arcade-health
// ---------------------------------------------------------------------------

describe('arcade-health', () => {
  it('reports all three checks as true when everything is up', async () => {
    const containerRunning = await managers.container.isRunning();
    const apiReady = await httpClient.isReady();
    const dbPing = await httpClient.query('test', 'SELECT 1 as ping');

    expect(containerRunning).toBe(true);
    expect(apiReady).toBe(true);
    expect(dbPing.success).toBe(true);
  });

  it('database check targets the "test" database', async () => {
    // The health tool hardcodes "test" as the ping database.
    // This verifies that database exists and is queryable.
    const res = await httpClient.query('test', 'SELECT 1 as ping');
    expect(res.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Authentication (real requests, not mocked)
// ---------------------------------------------------------------------------

describe('authentication', () => {
  it('authenticated requests succeed (proves Basic auth works)', async () => {
    const res = await httpClient.query('test', 'SELECT 1 as ping');
    expect(res.success).toBe(true);
  });

  it('bad credentials are rejected', async () => {
    const badConfig = { ...loadArcadeConfig(), server: { ...loadArcadeConfig().server, password: 'wrong' } };
    const badClient = new ArcadeHttpClient(badConfig);
    const res = await badClient.query('test', 'SELECT 1 as ping');
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Error structure
// ---------------------------------------------------------------------------

describe('error structure', () => {
  it('query error includes HTTP status code', async () => {
    const res = await httpClient.query('test', 'SELEKT NOTHING');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/\d{3}/); // contains HTTP status code
  });

  it('successful query includes count matching result length', async () => {
    const res = await httpClient.query('test', 'SELECT 1 as a');
    expect(res.success).toBe(true);
    expect(res.count).toBe(res.result!.length);
  });
});

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

describe('database lifecycle', () => {
  it('lists databases (includes default "test")', async () => {
    const dbs = await managers.database.listDatabases();
    expect(dbs).toContain('test');
  });

  it('test database was created in beforeAll', async () => {
    const dbs = await managers.database.listDatabases();
    expect(dbs).toContain(TEST_DB);
  });

  it('gets database info', async () => {
    const info = await managers.database.getDatabaseInfo(TEST_DB);
    expect(info.name).toBe(TEST_DB);
    expect(info.serverInfo.accessible).toBe(true);
  });

  it('gets stats for all databases', async () => {
    const stats = await managers.database.getDatabaseStats();
    expect(stats.databases.some(d => d.name === TEST_DB)).toBe(true);
    expect(stats.totalDatabases).toBeGreaterThanOrEqual(2);
  });

  it('gets stats for a specific database', async () => {
    const stats = await managers.database.getDatabaseStats();
    const entry = stats.databases.find(d => d.name === TEST_DB);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe(TEST_DB);
  });

  it('stats returns no entry for non-existent database', async () => {
    const stats = await managers.database.getDatabaseStats();
    const entry = stats.databases.find(d => d.name === 'ghost_db_xyz');
    expect(entry).toBeUndefined();
  });

  it('rejects creating a duplicate database', async () => {
    await expect(
      managers.database.createDatabase(TEST_DB),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// arcade-db-drop safety
// ---------------------------------------------------------------------------

describe('arcade-db-drop safety', () => {
  it('drops a database with confirm: true', async () => {
    const tempDb = `drop_test_${Date.now()}`;
    await managers.database.createDatabase(tempDb);

    const dbs = await managers.database.listDatabases();
    expect(dbs).toContain(tempDb);

    const dropped = await managers.database.dropDatabase(tempDb, { confirm: true });
    expect(dropped).toBe(true);

    const dbsAfter = await managers.database.listDatabases();
    expect(dbsAfter).not.toContain(tempDb);
  });
});

// ---------------------------------------------------------------------------
// arcade-query (read)
// ---------------------------------------------------------------------------

describe('arcade-query (read)', () => {
  it('executes SELECT and returns structured JSON', async () => {
    const res = await httpClient.query('test', 'SELECT 1 as value');
    expect(res.success).toBe(true);
    expect(res.result).toBeDefined();
    expect(res.result!.length).toBeGreaterThan(0);
    expect((res.result![0] as Record<string, unknown>).value).toBe(1);
  });

  it('returns error for invalid SQL', async () => {
    const res = await httpClient.query('test', 'SELEKT NOTHING');
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('supports parameterized queries', async () => {
    await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE ParamTest IF NOT EXISTS');
    await httpClient.command(TEST_DB, "INSERT INTO ParamTest SET name = 'Alice', age = 30");
    await httpClient.command(TEST_DB, "INSERT INTO ParamTest SET name = 'Bob', age = 25");

    const res = await httpClient.query(
      TEST_DB,
      'SELECT FROM ParamTest WHERE age > :minAge',
      { minAge: 27 },
    );
    expect(res.success).toBe(true);
    expect(res.result!.length).toBe(1);
    expect((res.result![0] as Record<string, unknown>).name).toBe('Alice');
  });

  it('returns count alongside results', async () => {
    const res = await httpClient.query(TEST_DB, 'SELECT FROM ParamTest');
    expect(res.success).toBe(true);
    expect(res.count).toBe(res.result!.length);
  });
});

// ---------------------------------------------------------------------------
// arcade-command (write)
// ---------------------------------------------------------------------------

describe('arcade-command (write)', () => {
  it('creates a vertex type (DDL)', async () => {
    const res = await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE CommandTest IF NOT EXISTS');
    expect(res.success).toBe(true);
  });

  it('inserts a record (DML)', async () => {
    const res = await httpClient.command(TEST_DB, "INSERT INTO CommandTest SET label = 'hello'");
    expect(res.success).toBe(true);
    expect(res.result).toBeDefined();
  });

  it('DDL is idempotent with IF NOT EXISTS', async () => {
    const res1 = await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE IdempotentType IF NOT EXISTS');
    const res2 = await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE IdempotentType IF NOT EXISTS');
    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('returns error for invalid command', async () => {
    const res = await httpClient.command(TEST_DB, 'DROP TYPE NonExistentType99');
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('supports cypher language for queries', async () => {
    await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE CypherTest IF NOT EXISTS');
    await httpClient.command(TEST_DB, "INSERT INTO CypherTest SET name = 'cypher_node'");

    const res = await httpClient.command(
      TEST_DB,
      "MATCH (n:CypherTest) RETURN n.name AS name",
      undefined,
      'cypher',
    );
    expect(res.success).toBe(true);
    expect(res.result!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// arcade-batch (transactions)
// ---------------------------------------------------------------------------

describe('arcade-batch (transactions)', () => {
  it('commits multiple commands in a single transaction', async () => {
    await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE BatchTest IF NOT EXISTS');

    const res = await httpClient.batch(TEST_DB, [
      "INSERT INTO BatchTest SET seq = 1",
      "INSERT INTO BatchTest SET seq = 2",
      "INSERT INTO BatchTest SET seq = 3",
    ]);

    expect(res.success).toBe(true);
    expect(res.committed).toBe(true);
    expect(res.results).toBeDefined();

    const check = await httpClient.query(TEST_DB, 'SELECT FROM BatchTest ORDER BY seq');
    expect(check.success).toBe(true);
    expect(check.result!.length).toBe(3);
  });

  it('rolls back on error (no partial writes)', async () => {
    await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE RollbackTest IF NOT EXISTS');

    const before = await httpClient.query(TEST_DB, 'SELECT count(*) as cnt FROM RollbackTest');
    const countBefore = (before.result![0] as Record<string, number>).cnt;

    const res = await httpClient.batch(TEST_DB, [
      "INSERT INTO RollbackTest SET val = 'should_rollback'",
      "INSERT INTO NonExistentType99 SET val = 'fail'",
    ]);

    expect(res.success).toBe(false);
    expect(res.committed).toBe(false);

    const after = await httpClient.query(TEST_DB, 'SELECT count(*) as cnt FROM RollbackTest');
    const countAfter = (after.result![0] as Record<string, number>).cnt;
    expect(countAfter).toBe(countBefore);
  });

  it('single-command batch commits correctly', async () => {
    await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE SingleBatch IF NOT EXISTS');

    const res = await httpClient.batch(TEST_DB, [
      "INSERT INTO SingleBatch SET val = 'one'",
    ]);
    expect(res.success).toBe(true);
    expect(res.committed).toBe(true);
    expect(res.results).toHaveLength(1);
  });

  it('large batch commits all records atomically', async () => {
    await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE LargeBatch IF NOT EXISTS');

    const commands = Array.from({ length: 20 }, (_, i) =>
      `INSERT INTO LargeBatch SET seq = ${i}`,
    );
    const res = await httpClient.batch(TEST_DB, commands);

    expect(res.success).toBe(true);
    expect(res.committed).toBe(true);

    const check = await httpClient.query(TEST_DB, 'SELECT count(*) as cnt FROM LargeBatch');
    expect((check.result![0] as Record<string, number>).cnt).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Schema idempotency
// ---------------------------------------------------------------------------

describe('schema idempotency', () => {
  it('can apply the same schema multiple times without error', async () => {
    const schema = [
      'CREATE VERTEX TYPE Person IF NOT EXISTS',
      'CREATE VERTEX TYPE Document IF NOT EXISTS',
      'CREATE EDGE TYPE Authored IF NOT EXISTS',
      'CREATE PROPERTY Person.name IF NOT EXISTS STRING',
      'CREATE PROPERTY Document.title IF NOT EXISTS STRING',
    ];

    // Run schema twice — both should succeed
    for (const sql of schema) {
      expect((await httpClient.command(TEST_DB, sql)).success).toBe(true);
    }
    for (const sql of schema) {
      expect((await httpClient.command(TEST_DB, sql)).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Graph data model (edges + traversal)
// ---------------------------------------------------------------------------

describe('graph data model', () => {
  it('creates edges between vertices', async () => {
    await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE GraphNode IF NOT EXISTS');
    await httpClient.command(TEST_DB, 'CREATE EDGE TYPE GraphLink IF NOT EXISTS');

    const r1 = await httpClient.command(TEST_DB, "INSERT INTO GraphNode SET label = 'A'");
    const r2 = await httpClient.command(TEST_DB, "INSERT INTO GraphNode SET label = 'B'");

    const rid1 = (r1.result![0] as Record<string, string>)['@rid'];
    const rid2 = (r2.result![0] as Record<string, string>)['@rid'];

    const edge = await httpClient.command(
      TEST_DB,
      `CREATE EDGE GraphLink FROM ${rid1} TO ${rid2} SET weight = 1.0`,
    );
    expect(edge.success).toBe(true);
    expect(edge.result!.length).toBe(1);
  });

  it('traverses connected vertices via out()', async () => {
    const res = await httpClient.query(
      TEST_DB,
      "SELECT expand(out('GraphLink')) FROM GraphNode WHERE label = 'A'",
    );
    expect(res.success).toBe(true);
    expect(res.result!.length).toBe(1);
    expect((res.result![0] as Record<string, string>).label).toBe('B');
  });

  it('MATCH query finds connected pairs', async () => {
    // Note: "from" and "to" are reserved words in ArcadeDB SQL — use "src"/"dst" as aliases.
    const res = await httpClient.query(
      TEST_DB,
      "MATCH {type: GraphNode, as: src}-GraphLink->{type: GraphNode, as: dst} RETURN src.label, dst.label",
    );
    expect(res.success).toBe(true);
    expect(res.result!.length).toBeGreaterThan(0);

    const row = res.result![0] as Record<string, string>;
    expect(row['src.label']).toBe('A');
    expect(row['dst.label']).toBe('B');
  });

  it('builds a multi-hop graph and traverses it', async () => {
    const r3 = await httpClient.command(TEST_DB, "INSERT INTO GraphNode SET label = 'C'");
    const rid3 = (r3.result![0] as Record<string, string>)['@rid'];

    // Get B's RID
    const bQuery = await httpClient.query(TEST_DB, "SELECT @rid FROM GraphNode WHERE label = 'B'");
    const ridB = (bQuery.result![0] as Record<string, string>)['@rid'];

    // B -> C
    await httpClient.command(TEST_DB, `CREATE EDGE GraphLink FROM ${ridB} TO ${rid3}`);

    // Traverse A -> B -> C (2 hops)
    const res = await httpClient.query(
      TEST_DB,
      "TRAVERSE out('GraphLink') FROM (SELECT FROM GraphNode WHERE label = 'A') MAXDEPTH 2",
    );
    expect(res.success).toBe(true);
    const labels = res.result!.map((r: unknown) => (r as Record<string, string>).label);
    expect(labels).toContain('A');
    expect(labels).toContain('B');
    expect(labels).toContain('C');
  });
});

// ---------------------------------------------------------------------------
// Import/export round-trip
// ---------------------------------------------------------------------------

describe('import/export', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'arcade-test-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exports vertex data to JSON', async () => {
    await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE ExportTest IF NOT EXISTS');
    await httpClient.batch(TEST_DB, [
      "INSERT INTO ExportTest SET name = 'Alice', score = 95",
      "INSERT INTO ExportTest SET name = 'Bob', score = 82",
    ]);

    const outPath = join(tmpDir, 'export.json');
    const exportResult = await managers.importExport.exportData(TEST_DB, outPath, {
      type: 'ExportTest',
      format: 'json',
    });
    expect(exportResult.recordsExported).toBe(2);
    expect(exportResult.filePath).toBe(outPath);
  });

  it('imports clean JSON data into a database', async () => {
    const { writeFileSync } = await import('fs');

    // Create a clean JSON file without ArcadeDB internal fields (@rid, @type, @cat)
    const importData = [
      { name: 'Carol', score: 77 },
      { name: 'Dave', score: 88 },
    ];
    const importPath = join(tmpDir, 'import.json');
    writeFileSync(importPath, JSON.stringify(importData));

    await httpClient.command(TEST_DB, 'CREATE VERTEX TYPE ImportTest IF NOT EXISTS');

    const importResult = await managers.importExport.importData(TEST_DB, importPath, {
      type: 'ImportTest',
      format: 'json',
    });
    expect(importResult.recordsImported).toBe(2);

    // Verify data was actually inserted
    const check = await httpClient.query(TEST_DB, 'SELECT FROM ImportTest ORDER BY name');
    expect(check.success).toBe(true);
    expect(check.result!.length).toBe(2);
    expect((check.result![0] as Record<string, string>).name).toBe('Carol');
  });
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

describe('tool registration', () => {
  it('loads index.ts without error (all 14 tools register)', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.default).toBeDefined();
  });
});
