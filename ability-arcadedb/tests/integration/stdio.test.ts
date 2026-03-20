/**
 * Stdio protocol integration test.
 *
 * Loads arcadedb-ability as a child process via KADI's stdio transport,
 * verifies tool discovery, and invokes a real query against ArcadeDB.
 *
 * Requires:
 *   - ArcadeDB running: `docker compose up -d arcadedb` from tmis-paper/
 *   - Built project: `npm run build`
 */

import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KadiClient } from '@kadi.build/core';
import type { LoadedAbility } from '@kadi.build/core';

const ENTRY = resolve(__dirname, '../../src/index.ts');

describe('stdio protocol', () => {
  let client: KadiClient;
  let ability: LoadedAbility;

  beforeEach(async () => {
    client = new KadiClient({ name: 'test-harness', version: '1.0.0' });

    ability = await client.loadStdio('arcadedb-ability', {
      command: 'npx',
      args: ['tsx', ENTRY],
    });
  });

  afterEach(async () => {
    await ability?.disconnect().catch(() => {});
    await client?.disconnect().catch(() => {});
  });

  it('discovers all 14 tools', () => {
    const tools = ability.getTools();
    expect(tools).toHaveLength(14);

    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'arcade-batch',
      'arcade-command',
      'arcade-db-create',
      'arcade-db-drop',
      'arcade-db-info',
      'arcade-db-list',
      'arcade-db-stats',
      'arcade-export',
      'arcade-health',
      'arcade-import',
      'arcade-query',
      'arcade-start',
      'arcade-status',
      'arcade-stop',
    ]);
  });

  it('every tool has a description and input schema', () => {
    for (const tool of ability.getTools()) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('invokes arcade-query via stdio and returns results', async () => {
    const result = await ability.invoke('arcade-query', {
      database: 'test',
      query: 'SELECT 1 as value',
    });

    const res = result as Record<string, unknown>;
    expect(res.success).toBe(true);
    expect(res.result).toBeDefined();
    expect((res.result as unknown[])[0]).toEqual({ value: 1 });
  });

  it('invokes arcade-db-list via stdio', async () => {
    const result = await ability.invoke('arcade-db-list', {});

    const res = result as Record<string, unknown>;
    expect(res.success).toBe(true);
    expect(res.databases).toBeDefined();
    expect((res.databases as string[])).toContain('test');
  });

  it('invokes arcade-health via stdio', async () => {
    const result = await ability.invoke('arcade-health', {});

    const res = result as Record<string, unknown>;
    expect(res.healthy).toBe(true);
    const checks = res.checks as Record<string, boolean>;
    expect(checks.container).toBe(true);
    expect(checks.api).toBe(true);
  });
});
